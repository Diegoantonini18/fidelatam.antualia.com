"use client"

import { useRouter } from "next/navigation"

import type React from "react"

import { useState, useEffect, useCallback, useRef } from "react"
import { Input } from "@/components/ui/input"
import { CognitoUserPool } from "amazon-cognito-identity-js"
import { AppHeader } from "@/components/app-header"
import { DateRangePicker } from "@/components/date-range-picker"
import type { DateRange } from "react-day-picker"
import { Button } from "@/components/ui/button"
import { Loader2, Upload, Download, Eye, X, ChevronLeft, ChevronRight } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { format, parseISO } from "date-fns"
import { es } from "date-fns/locale"
import * as XLSX from "xlsx"
import { RouteGuard } from "@/components/route-guard"

// Importar la función authenticatedFetch
import { authenticatedFetch, redirectToLoginIfInvalidToken, verifyToken } from "@/utils/auth-utils"

// Configuración de Cognito
const poolData = {
  UserPoolId: "us-east-1_tY3372P8t",
  ClientId: "74j6ahmpqbco9uaaonj5qpfaag",
}

const userPool = new CognitoUserPool(poolData)

// Tipo para los documentos
interface Documento {
  cliente: string
  fechaCarga: string
  fechaComprobante: string
  numeroTransaccion: string
  banco: string
  destinatario: string
  tipo: string
  enviadoPor: string
  pk?: string
  sk?: string
  estado?: string
  fileName?: string // Updated to match the API response (capital N)
  filename?: string // Keep this for backward compatibility
  numeroFactura?: string
  numerofactura?: string
  nombreFarmacia?: string
  totalFactura?: string
  productos?: {
    descripcion: string
    cantidad: number
    precio_unitario?: number
    precio_bruto?: string
    precio_neto?: string
    precio_subtotal?: string
    codigo_de_articulo?: string
    importe?: string
  }[]
  promedio_confianza_textract?: number
}

// Tipo para la respuesta de la API
interface ApiResponse {
  "body-json": {
    statusCode: number
    body: string
  }
  params: any
}

// Tipo para los atributos de DynamoDB
interface DynamoDBItem {
  [key: string]: {
    S?: string
    N?: string
    BOOL?: boolean
    L?: any[]
    M?: any
    // Otros tipos de DynamoDB si son necesarios
  }
}

// Modificar la interfaz PresignedUrlResponse para incluir el ulid
interface PresignedUrlResponse {
  uploadURL: string
  key?: string
  ulid: string
}

// Definir un tipo para el campo que se está editando
type EditingField = {
  rowIndex: number
  field: keyof Documento
  value: string
} | null

export default function TransaccionesPage() {
  const router = useRouter()
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)
  const [documentos, setDocumentos] = useState<Documento[]>([])
  const [documentosSinFiltrar, setDocumentosSinFiltrar] = useState<Documento[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [initialLoadDone, setInitialLoadDone] = useState(false)

  // Agregar un nuevo estado para el loader inicial
  const [initialLoading, setInitialLoading] = useState(true)

  // Estados para el manejo de subida de archivos
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Añadir un nuevo estado para el filtro de "Enviado Por"
  const [enviadoPorFilter, setEnviadoPorFilter] = useState("")

  // Estados para el visor de documentos
  const [viewerOpen, setViewerOpen] = useState(false)
  const [currentDocument, setCurrentDocument] = useState<string | null>(null)

  // Reemplazar el estado de edición por fila con un estado para el campo específico que se está editando
  const [editingField, setEditingField] = useState<EditingField>(null)

  // Estado para controlar el modal de edición
  const [editModalOpen, setEditModalOpen] = useState(false)

  // Estados para paginación
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(10)
  const [totalPages, setTotalPages] = useState(1)
  const [paginatedDocumentos, setPaginatedDocumentos] = useState<Documento[]>([])

  // Agregar dos nuevos estados para los filtros
  const [importeFilter, setImporteFilter] = useState("")
  const [destinatarioFilter, setDestinatarioFilter] = useState("")

  // Agregar un nuevo estado para el loader de subida
  const [uploadLoading, setUploadLoading] = useState(false)

  // Función para convertir un objeto DynamoDB a un objeto JavaScript plano
  const convertirDynamoDBItem = (item: DynamoDBItem): Documento => {
    const resultado: any = {}

    // Recorrer todas las propiedades del item
    for (const [key, value] of Object.entries(item)) {
      // Extraer el valor según el tipo de DynamoDB
      if (value.S !== undefined) {
        resultado[key] = value.S
      } else if (value.N !== undefined) {
        resultado[key] = value.N
      } else if (value.BOOL !== undefined) {
        resultado[key] = value.BOOL
      } else if (value.L !== undefined && key === "productos") {
        // Procesar la lista de productos
        resultado[key] = value.L.map((producto: any) => {
          if (producto.M) {
            return {
              descripcion: producto.M.descripcion?.S || "",
              precio_unitario: producto.M.precio_unitario?.N
                ? Number(producto.M.precio_unitario.N)
                : producto.M.precio_unitario?.S
                  ? Number(producto.M.precio_unitario.S)
                  : undefined,
              precio_bruto: producto.M.precio_bruto?.N || producto.M.precio_bruto?.S || "",
              precio_neto: producto.M.precio_neto?.N || producto.M.precio_neto?.S || "",
              precio_subtotal: producto.M.precio_subtotal?.N || producto.M.precio_subtotal?.S || "",
              cantidad: Number(producto.M.cantidad?.N || "0"),
              codigo_de_articulo: producto.M.codigo_de_articulo?.S || "",
              importe: producto.M.importe?.S || "0",
            }
          }
          return producto
        })
      } else if (value.N !== undefined && key === "promedio_confianza_textract") {
        resultado[key] = Number.parseFloat(value.N)
      }
      // Añadir más tipos si es necesario
    }

    // Asignar cliente como destinatario si no existe
    if (!resultado.cliente && resultado.destinatario) {
      resultado.cliente = resultado.destinatario
    }

    // Asignar fechaCarga como la fecha actual si no existe
    if (!resultado.fechaCarga) {
      resultado.fechaCarga = new Date().toISOString().split("T")[0]
    }

    return resultado as Documento
  }

  // Modificar la función aplicarFiltros para incluir los nuevos filtros
  const aplicarFiltros = useCallback(
    (docs: Documento[]) => {
      let documentosFiltrados = [...docs]

      // Aplicar filtro de "Enviado Por" si existe
      if (enviadoPorFilter.trim()) {
        const filtroLowerCase = enviadoPorFilter.trim().toLowerCase()
        documentosFiltrados = documentosFiltrados.filter((doc) => {
          // Verificar si enviadoPor existe y comienza con el texto del filtro
          return doc.enviadoPor && doc.enviadoPor.toLowerCase().includes(filtroLowerCase)
        })
      }

      // Aplicar filtro de "Importe" si existe
      if (importeFilter.trim()) {
        // Normalizar el filtro: eliminar puntos, comas y espacios
        const filtroNormalizado = importeFilter.trim().replace(/[.,\s]/g, "")
        documentosFiltrados = documentosFiltrados.filter((doc) => {
          // Normalizar el importe del documento
          const importeNormalizado = doc.importe ? doc.importe.replace(/[.,\s]/g, "") : ""
          return importeNormalizado.includes(filtroNormalizado)
        })
      }

      // Aplicar filtro de "Destinatario" si existe
      if (destinatarioFilter.trim()) {
        const filtroLowerCase = destinatarioFilter.trim().toLowerCase()
        documentosFiltrados = documentosFiltrados.filter((doc) => {
          return doc.destinatario && doc.destinatario.toLowerCase().includes(filtroLowerCase)
        })
      }

      setDocumentos(documentosFiltrados)
    },
    [enviadoPorFilter, importeFilter, destinatarioFilter],
  )

  // Función para formatear la fecha
  const formatearFecha = (fechaStr: string) => {
    try {
      // Verificar si la fecha tiene formato ISO
      if (fechaStr.includes("T")) {
        return format(parseISO(fechaStr), "dd/MM/yyyy HH:mm", { locale: es })
      }

      // Si es solo fecha (YYYY-MM-DD)
      if (fechaStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        return format(parseISO(fechaStr), "dd/MM/yyyy", { locale: es })
      }

      // Si ya está en formato dd/MM/yyyy o no se puede parsear, devolverlo tal cual
      return fechaStr
    } catch (error) {
      console.error("Error al formatear fecha:", error)
      return fechaStr
    }
  }

  // Modificar la función fetchDocumentos para usar authenticatedFetch
  const fetchDocumentos = useCallback(
    async (authToken: string, date?: string, mostrarCarga = true) => {
      if (mostrarCarga) {
        setLoading(true)
      }
      setError(null)

      try {
        // Verificar si el token es válido antes de hacer la solicitud
        const isValid = await redirectToLoginIfInvalidToken()
        if (!isValid) return

        // Construir la URL con el parámetro de fecha si existe
        let url = "https://yifyt5glb5.execute-api.us-east-1.amazonaws.com/prd/get_facturas"
        if (date) {
          url += `?startDate=${date}&endDate=${date}`
        }

        console.log("Fetching documents from:", url)

        // Usar authenticatedFetch en lugar de fetch
        const response = await authenticatedFetch(url)

        if (!response.ok) {
          throw new Error(`Error al obtener datos: ${response.status} ${response.statusText}`)
        }

        // Resto del código igual...
        const apiResponse: ApiResponse = await response.json()

        // Verificar que la respuesta tenga el formato esperado
        if (!apiResponse["body-json"] || !apiResponse["body-json"].body) {
          throw new Error("Formato de respuesta inválido")
        }

        // Parsear el string JSON que está dentro de body
        let itemsDynamoDB
        try {
          const parsedBody = JSON.parse(apiResponse["body-json"].body)

          // Verificar si el resultado es un array
          if (Array.isArray(parsedBody)) {
            itemsDynamoDB = parsedBody
          } else {
            console.log("Parsed body is not an array:", parsedBody)
            // Si no es un array, podría estar en otra propiedad
            if (parsedBody.Items && Array.isArray(parsedBody.Items)) {
              itemsDynamoDB = parsedBody.Items
            } else {
              throw new Error("Los datos recibidos no tienen el formato esperado")
            }
          }
        } catch (parseError) {
          console.error("Error parsing response body:", parseError)
          throw new Error("Error al procesar la respuesta del servidor")
        }

        // Verificar que itemsDynamoDB sea un array antes de usar map
        if (!Array.isArray(itemsDynamoDB)) {
          console.error("itemsDynamoDB is not an array:", itemsDynamoDB)
          throw new Error("Los datos recibidos no tienen el formato esperado (no es un array)")
        }

        // Convertir los items de DynamoDB a objetos JavaScript planos
        const documentosProcesados = itemsDynamoDB.map(convertirDynamoDBItem)
        console.log("Processed documents:", documentosProcesados.length)

        // Guardar todos los documentos sin filtrar
        setDocumentosSinFiltrar(documentosProcesados)

        // Aplicar filtro de "Enviado Por" si existe
        aplicarFiltros(documentosProcesados)
      } catch (err) {
        console.error("Error al obtener documentos:", err)

        // Si el error es por token inválido, no mostrar mensaje de error
        if (err instanceof Error && err.message === "Token inválido") {
          return
        }

        setError(err instanceof Error ? err.message : "Error al cargar los datos")
        setDocumentos([]) // Limpiar documentos en caso de error
        setDocumentosSinFiltrar([])
      } finally {
        if (mostrarCarga) {
          setLoading(false)
        }
        // Siempre desactivar el loader inicial después de la primera carga
        setInitialLoading(false)
      }
    },
    [aplicarFiltros, enviadoPorFilter],
  )

  // Modificar la función fetchDocumentosRango de manera similar
  const fetchDocumentosRango = useCallback(
    async (authToken: string, fromDate: string, toDate: string, mostrarCarga = true) => {
      if (mostrarCarga) {
        setLoading(true)
      }
      setError(null)

      try {
        // Verificar si el token es válido antes de hacer la solicitud
        const isValid = await redirectToLoginIfInvalidToken()
        if (!isValid) return

        // Construir la URL con los parámetros de fecha de inicio y fin
        const url = `https://yifyt5glb5.execute-api.us-east-1.amazonaws.com/prd/get_facturas?startDate=${fromDate}&endDate=${toDate}`

        console.log(`Fetching documents from ${fromDate} to ${toDate}`)
        console.log("Using URL:", url)

        // Usar authenticatedFetch en lugar de fetch
        const response = await authenticatedFetch(url)

        if (!response.ok) {
          throw new Error(`Error al obtener datos: ${response.status} ${response.statusText}`)
        }

        // Parsear la respuesta completa
        const apiResponse: ApiResponse = await response.json()

        // Verificar que la respuesta tenga el formato esperado
        if (!apiResponse["body-json"] || !apiResponse["body-json"].body) {
          throw new Error("Formato de respuesta inválido")
        }

        // Parsear el string JSON que está dentro de body
        let itemsDynamoDB
        try {
          const parsedBody = JSON.parse(apiResponse["body-json"].body)

          // Verificar si el resultado es un array
          if (Array.isArray(parsedBody)) {
            itemsDynamoDB = parsedBody
          } else {
            console.log("Parsed body is not an array:", parsedBody)
            // Si no es un array, podría estar en otra propiedad
            if (parsedBody.Items && Array.isArray(parsedBody.Items)) {
              itemsDynamoDB = parsedBody.Items
            } else {
              throw new Error("Los datos recibidos no tienen el formato esperado")
            }
          }
        } catch (parseError) {
          console.error("Error parsing response body:", parseError)
          throw new Error("Error al procesar la respuesta del servidor")
        }

        // Verificar que itemsDynamoDB sea un array antes de usar map
        if (!Array.isArray(itemsDynamoDB)) {
          console.error("itemsDynamoDB is not an array:", itemsDynamoDB)
          throw new Error("Los datos recibidos no tienen el formato esperado (no es un array)")
        }

        // Convertir los items de DynamoDB a objetos JavaScript planos
        const documentosProcesados = itemsDynamoDB.map(convertirDynamoDBItem)
        console.log("Processed documents:", documentosProcesados.length)

        // Guardar todos los documentos sin filtrar
        setDocumentosSinFiltrar(documentosProcesados)

        // Aplicar filtro de "Enviado Por" si existe
        aplicarFiltros(documentosProcesados)
      } catch (err) {
        console.error("Error al obtener documentos:", err)

        // Si el error es por token inválido, no mostrar mensaje de error
        if (err instanceof Error && err.message === "Token inválido") {
          return
        }

        setError(err instanceof Error ? err.message : "Error al cargar los datos")
        setDocumentos([]) // Limpiar documentos en caso de error
        setDocumentosSinFiltrar([])
      } finally {
        if (mostrarCarga) {
          setLoading(false)
        }
        // Siempre desactivar el loader inicial después de la primera carga
        setInitialLoading(false)
      }
    },
    [aplicarFiltros, enviadoPorFilter],
  )

  // Función para recargar los datos
  const recargarDatos = useCallback(
    (mostrarCarga = true) => {
      if (!token) {
        setError("No se encontró el token de autenticación")
        return
      }

      // Solo mostrar el indicador de carga si se solicita explícitamente
      if (mostrarCarga) {
        setLoading(true)
      }

      if (dateRange?.from) {
        if (dateRange.to) {
          // Si hay un rango completo
          const fromDate = format(dateRange.from, "yyyy-MM-dd")
          const toDate = format(dateRange.to, "yyyy-MM-dd")
          fetchDocumentosRango(token, fromDate, toDate, mostrarCarga)
        } else {
          // Si solo hay fecha inicial
          const formattedDate = format(dateRange.from, "yyyy-MM-dd")
          fetchDocumentos(token, formattedDate, mostrarCarga)
        }
      } else {
        // Si no hay fecha seleccionada, cargar todos los documentos
        fetchDocumentos(token, undefined, mostrarCarga)
      }
    },
    [dateRange, fetchDocumentos, fetchDocumentosRango, token],
  )

  // Actualizar el efecto para aplicar filtros cuando cambien los nuevos filtros
  useEffect(() => {
    if (documentosSinFiltrar.length > 0) {
      aplicarFiltros(documentosSinFiltrar)
    }
  }, [enviadoPorFilter, importeFilter, destinatarioFilter, documentosSinFiltrar, aplicarFiltros])

  // Efecto para manejar la paginación
  useEffect(() => {
    if (documentos.length > 0) {
      // Calcular el total de páginas
      const pages = Math.ceil(documentos.length / itemsPerPage)
      setTotalPages(pages)

      // Asegurarse de que la página actual es válida
      const validPage = Math.min(currentPage, pages)
      if (validPage !== currentPage) {
        setCurrentPage(validPage)
      }

      // Obtener los documentos para la página actual
      const startIndex = (validPage - 1) * itemsPerPage
      const endIndex = startIndex + itemsPerPage
      setPaginatedDocumentos(documentos.slice(startIndex, endIndex))
    } else {
      setPaginatedDocumentos([])
      setTotalPages(1)
      setCurrentPage(1)
    }
  }, [documentos, currentPage, itemsPerPage])

  // Verificar autenticación al cargar la página
  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Verificar si el token es válido de manera estricta
        console.log("Verificando autenticación en página principal...")
        const isValid = await verifyToken()

        if (!isValid) {
          console.log("Token inválido o caducado en página principal, redirigiendo a login")
          // Limpiar todas las credenciales de Cognito del localStorage
          localStorage.removeItem("idToken")

          // Buscar y eliminar todas las claves relacionadas con Cognito
          Object.keys(localStorage).forEach((key) => {
            if (key.startsWith("CognitoIdentityServiceProvider")) {
              localStorage.removeItem(key)
            }
          })

          window.location.href = "/login"
          return
        }

        // Obtener el token de localStorage
        const storedToken = localStorage.getItem("idToken")

        // Guardar el token
        setToken(storedToken)
        setAuthChecked(true)

        // Cargar datos con el token almacenado
        if (!initialLoadDone && storedToken) {
          fetchDocumentos(storedToken)
          setInitialLoadDone(true)
        }
      } catch (error) {
        console.error("Error checking auth:", error)
        // Limpiar todas las credenciales de Cognito del localStorage
        localStorage.removeItem("idToken")

        // Buscar y eliminar todas las claves relacionadas con Cognito
        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith("CognitoIdentityServiceProvider")) {
            localStorage.removeItem(key)
          }
        })

        window.location.href = "/login" // Redirigir en caso de error también
      }
    }

    checkAuth()
  }, [fetchDocumentos])

  // Configurar actualización automática cada 10 segundos
  useEffect(() => {
    if (!token || !recargarDatos) return

    console.log("Configurando actualización automática cada 10 segundos")

    const interval = setInterval(async () => {
      console.log("Ejecutando actualización automática")

      // Verificar si el token es válido antes de recargar datos
      const isValid = await verifyToken()

      if (!isValid) {
        console.log("Token inválido o caducado durante actualización automática, redirigiendo a login")
        // Limpiar todas las credenciales de Cognito del localStorage
        localStorage.removeItem("idToken")

        // Buscar y eliminar todas las claves relacionadas con Cognito
        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith("CognitoIdentityServiceProvider")) {
            localStorage.removeItem(key)
          }
        })

        window.location.href = "/login"
        return
      }

      // Pasar false para no mostrar el indicador de carga
      recargarDatos(false)
    }, 10000) // 10 segundos

    // Limpiar el intervalo cuando el componente se desmonte
    return () => {
      console.log("Limpiando intervalo de actualización automática")
      clearInterval(interval)
    }
  }, [token, recargarDatos])

  // Función para manejar el cambio de fecha (solo actualiza el estado, no ejecuta la API)
  const handleDateRangeChange = (range: DateRange | undefined) => {
    setDateRange(range)
  }

  // Función para aplicar el filtro de fecha y ejecutar la API
  const handleApplyDateRange = (range: DateRange | undefined) => {
    if (!token) return

    if (range?.from) {
      // Si hay un rango completo, usamos ambas fechas
      if (range.to) {
        const fromDate = format(range.from, "yyyy-MM-dd")
        const toDate = format(range.to, "yyyy-MM-dd")
        fetchDocumentosRango(token, fromDate, toDate)
      } else {
        // Si solo hay fecha inicial, usamos esa fecha como inicio y fin
        const formattedDate = format(range.from, "yyyy-MM-dd")
        fetchDocumentos(token, formattedDate)
      }
    } else {
      // Si no hay rango, cargar todos los documentos
      fetchDocumentos(token)
    }
  }

  // Función para abrir el visor de documentos
  const handleViewDocument = (documento: Documento) => {
    // Get sk and fileName from the document (using the correct property name)
    const sk = documento.sk || ""
    // Try to get fileName with capital N first, then fallback to lowercase n
    const fileName = documento.fileName || documento.filename || ""

    // Construct the URL
    const url = `https://fideletam-facturas.s3.us-east-1.amazonaws.com/facturas/${sk}/${fileName}`

    // Log the document URL being accessed
    console.log("Viewing document:", url)
    console.log("Document sk:", sk)
    console.log("Document fileName:", fileName)
    console.log("Full document object:", documento)

    // Set the current document and open the viewer
    setCurrentDocument(url)
    setViewerOpen(true)
  }

  // Función para cerrar el visor de documentos
  const handleCloseViewer = () => {
    setViewerOpen(false)
    setCurrentDocument(null)
  }

  // Función para eliminar un documento
  const handleDeleteDocument = async () => {
    if (!currentDocument || !token) return

    try {
      setLoading(true)

      // Extract the sk from the current document URL
      const urlParts = currentDocument.split("/")
      const sk = urlParts[urlParts.length - 2] // The sk is the second-to-last part of the URL

      console.log("Deleting document with sk:", sk)

      const response = await authenticatedFetch(
        "https://mbkhos7wyj.execute-api.us-east-1.amazonaws.com/prd/documentos/eliminar_archivos",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sk }),
        },
      )

      if (!response.ok) {
        const errorText = await response.text()
        console.error("Error en respuesta de API:", errorText)
        throw new Error(`Error al eliminar documento: ${response.status} ${response.statusText}`)
      }

      console.log("Documento eliminado exitosamente")

      // Close the viewer and reload data
      handleCloseViewer()
      recargarDatos()
    } catch (err) {
      console.error("Error eliminando documento:", err)
      setError(err instanceof Error ? err.message : "Error desconocido al eliminar el documento")
    } finally {
      setLoading(false)
    }
  }

  // Nueva función para manejar el doble clic en una celda
  const handleCellDoubleClick = (rowIndex: number, field: keyof Documento, value: string) => {
    // No permitir edición si el documento está en estado "procesando"
    const documento = paginatedDocumentos[rowIndex]
    if (documento.estado === "procesando") return

    // Establecer el campo que se está editando
    setEditingField({
      rowIndex,
      field,
      value,
    })

    // Abrir el modal de edición
    setEditModalOpen(true)
  }

  // Función para manejar cambios en el campo que se está editando
  const handleEditFieldChange = (value: string) => {
    if (editingField) {
      setEditingField({
        ...editingField,
        value,
      })
    }
  }

  // Función para guardar el campo editado
  const handleSaveField = async () => {
    if (!editingField || !token) {
      setError("No se encontró el campo a editar o el token de autenticación")
      return
    }

    try {
      setLoading(true)

      // Obtener el documento que se está editando
      const documento = documentos[editingField.rowIndex]

      // Verificar que el documento tenga un sk
      if (!documento.sk) {
        throw new Error("El documento no tiene un identificador (sk)")
      }

      console.log("Guardando cambios para documento con sk:", documento.sk)

      // Crear una copia del documento con el campo actualizado
      const updatedDocumento = {
        ...documento,
        [editingField.field]: editingField.value,
      }

      // Preparar el cuerpo de la solicitud con el sk y todos los campos editables
      const requestBody = {
        sk: documento.sk,
        cliente: updatedDocumento.cliente,
        fechaCarga: updatedDocumento.fechaCarga,
        fechaComprobante: updatedDocumento.fechaComprobante,
        importe: updatedDocumento.importe,
        numeroTransaccion: updatedDocumento.numeroTransaccion,
        banco: updatedDocumento.banco,
        destinatario: updatedDocumento.destinatario,
        tipo: updatedDocumento.tipo,
        enviadoPor: updatedDocumento.enviadoPor,
      }

      console.log("Enviando datos para actualizar:", requestBody)

      // Realizar la llamada a la API
      const response = await authenticatedFetch(
        "https://mbkhos7wyj.execute-api.us-east-1.amazonaws.com/prd/documentos/editar_documentos",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        },
      )

      if (!response.ok) {
        const errorText = await response.text()
        console.error("Error en respuesta de API:", errorText)
        throw new Error(`Error al guardar cambios: ${response.status} ${response.statusText}`)
      }

      console.log("Documento actualizado exitosamente")

      // Cerrar el modal de edición
      setEditModalOpen(false)
      setEditingField(null)

      // Recargar los datos para mostrar los cambios
      recargarDatos()
    } catch (err) {
      console.error("Error guardando cambios:", err)
      setError(err instanceof Error ? err.message : "Error desconocido al guardar los cambios")
    } finally {
      setLoading(false)
    }
  }

  // Modificar la función getPresignedUrl para extraer correctamente el ulid
  const getPresignedUrl = async (file: File) => {
    if (!token) {
      throw new Error("No se encontró el token de autenticación")
    }

    const fileType = file.type
    const fileName = file.name

    try {
      const response = await authenticatedFetch("https://yifyt5glb5.execute-api.us-east-1.amazonaws.com/prd/url_put", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileName,
          fileType,
        }),
      })

      if (!response.ok) {
        throw new Error(`Error al obtener URL prefirmada: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()

      // Verificar si la respuesta tiene el formato esperado
      if (data["body-json"] && data["body-json"].body) {
        // Parsear el body si es un string
        const parsedBody =
          typeof data["body-json"].body === "string" ? JSON.parse(data["body-json"].body) : data["body-json"].body

        return parsedBody as PresignedUrlResponse
      }

      throw new Error("Formato de respuesta inválido para URL prefirmada")
    } catch (error) {
      console.error("Error obteniendo URL prefirmada:", error)
      throw error
    }
  }

  // Añadir una nueva función para notificar a la API después de subir el archivo
  const notifyFileUploaded = async (fileName: string, ulid: string) => {
    if (!token) {
      throw new Error("No se encontró el token de autenticación")
    }

    try {
      console.log("Enviando notificación POST con datos:", { fileName, ulid })
      const enviadoPor = "manual"

      const response = await authenticatedFetch(
        "https://yifyt5glb5.execute-api.us-east-1.amazonaws.com/prd/procesar_documentos",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileName,
            ulid,
            enviadoPor,
          }),
        },
      )

      if (!response.ok) {
        const errorText = await response.text()
        console.error("Error en respuesta de API:", errorText)
        throw new Error(`Error al notificar archivo subido: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      console.log("Notificación de archivo subido exitosa:", data)
      return data
    } catch (error) {
      console.error("Error notificando archivo subido:", error)
      throw error
    }
  }

  // Modificar la función handleFileSelected para incluir la notificación después de subir el archivo
  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return

    const file = e.target.files[0]

    try {
      setUploadLoading(true)
      setError(null)

      // Obtener URL prefirmada
      const presignedData = await getPresignedUrl(file)
      console.log("URL prefirmada obtenida:", presignedData)

      // Subir archivo
      const uploadSuccess = await uploadFileToPresignedUrl(presignedData, file)
      console.log("Archivo subido exitosamente:", uploadSuccess)

      if (uploadSuccess) {
        // Notificar a la API que el archivo se ha subido correctamente
        console.log("Notificando a la API sobre archivo subido:", file.name, presignedData.ulid)
        await notifyFileUploaded(file.name, presignedData.ulid)
        console.log("Notificación completada")

        // Recargar datos después de procesar
        recargarDatos()
      }

      // Limpiar el input de archivo
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    } catch (err) {
      console.error("Error en el proceso de subida:", err)
      setError(err instanceof Error ? err.message : "Error desconocido al subir el archivo")
    } finally {
      setUploadLoading(false)
    }
  }

  // Función para subir el archivo a la URL prefirmada
  const uploadFileToPresignedUrl = async (presignedData: PresignedUrlResponse, file: File) => {
    try {
      const response = await fetch(presignedData.uploadURL, {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
        },
        body: file,
      })

      if (!response.ok) {
        throw new Error(`Error al subir archivo: ${response.status} ${response.statusText}`)
      }

      console.log("Archivo subido correctamente a S3")
      return true
    } catch (error) {
      console.error("Error subiendo archivo:", error)
      throw error
    }
  }

  // Agregar funciones para manejar los nuevos filtros
  const handleImporteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setImporteFilter(value)
  }

  const handleDestinatarioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setDestinatarioFilter(value)
  }

  // Función para manejar el cambio en el filtro "Enviado Por"
  const handleEnviadoPorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setEnviadoPorFilter(value)
  }

  // Funciones para navegar entre páginas
  const goToNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1)
    }
  }

  const goToPreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1)
    }
  }

  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page)
    }
  }

  // Función para descargar los datos filtrados como Excel
  const handleExcelDownload = () => {
    try {
      // Crear una copia de los datos filtrados para la exportación
      const dataToExport = documentos.map((doc) => ({
        CLIENTE: doc.cliente || doc.destinatario,
        "FECHA DE CARGA": doc.fechaCarga,
        "FECHA DE COMPROBANTE": doc.fechaComprobante,
        IMPORTE: doc.importe,
        "NUMERO DE TRANSACCION": doc.numeroTransaccion,
        BANCO: doc.banco,
        DESTINATARIO: doc.destinatario,
        "TRF / DEPOSITO": doc.tipo,
        "ENVIADO POR": doc.enviadoPor,
      }))

      // Crear un libro de trabajo y una hoja
      const ws = XLSX.utils.json_to_sheet(dataToExport)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, "Documentos")

      // Generar el archivo en formato binario
      const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" })

      // Crear un Blob con los datos
      const blob = new Blob([excelBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })

      // Crear URL para el blob
      const url = URL.createObjectURL(blob)

      // Crear un elemento de enlace para la descarga
      const a = document.createElement("a")
      const fechaActual = new Date().toISOString().split("T")[0]
      const nombreArchivo = `documentos_${fechaActual}.xlsx`

      a.href = url
      a.download = nombreArchivo
      document.body.appendChild(a)
      a.click()

      // Limpiar
      setTimeout(() => {
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }, 0)
    } catch (err) {
      console.error("Error al generar el archivo Excel:", err)
      setError("Error al generar el archivo Excel")
    }
  }

  // Función para obtener el título del campo según su clave
  const getFieldTitle = (field: keyof Documento): string => {
    const titles: Record<keyof Documento, string> = {
      cliente: "Cliente",
      fechaCarga: "Fecha de Carga",
      fechaComprobante: "Fecha de Comprobante",
      importe: "Importe",
      numeroTransaccion: "Número de Transacción",
      banco: "Banco",
      destinatario: "Destinatario",
      tipo: "TRF / Depósito",
      enviadoPor: "Enviado Por",
      pk: "PK",
      sk: "SK",
      estado: "Estado",
      fileName: "Nombre de Archivo",
      filename: "Nombre de Archivo",
    }

    return titles[field] || field
  }

  // Si aún no se ha verificado la autenticación o está cargando inicialmente, mostrar un indicador de carga
  if (!authChecked || !token || initialLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p>{!authChecked || !token ? "Verificando autenticación..." : "Cargando facturas..."}</p>
        </div>
      </div>
    )
  }

  return (
    <RouteGuard>
      <div className="min-h-screen bg-white">
        <AppHeader />
        <div className="p-4 text-base">
          {/* Reemplazar la sección de filtros en el JSX con una versión más compacta que incluya los nuevos filtros */}
          {/* Buscar y reemplazar esta sección: */}
          <div className="flex flex-col md:flex-row gap-1 mb-3 items-start flex-wrap">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-1 w-full md:w-3/4">
              <div>
                <label className="block text-xs font-medium mb-0.5">Fecha:</label>
                <DateRangePicker
                  dateRange={dateRange}
                  onDateRangeChange={handleDateRangeChange}
                  onApply={handleApplyDateRange}
                  className="text-xs"
                />
              </div>
            </div>
            <div className="w-full md:w-auto md:flex-shrink-0 flex gap-1 md:ml-auto mt-1 md:mt-4">
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 h-7 text-xs"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadLoading}
              >
                {uploadLoading ? (
                  <>
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    <span className="text-xs">Procesando...</span>
                  </>
                ) : (
                  <>
                    <Upload className="mr-1 h-3 w-3" />
                    <span className="text-xs">Subir</span>
                  </>
                )}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleFileSelected}
              />
            </div>
          </div>

          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="overflow-x-auto">
            <table className="w-full border-collapse rounded-lg overflow-hidden text-xs">
              <thead>
                <tr className="bg-blue-600 text-white">
                  <th className="border border-blue-700 px-2 py-1.5 text-left text-xs font-medium">
                    NÚMERO DE FACTURA
                  </th>
                  <th className="border border-blue-700 px-2 py-1.5 text-left text-xs font-medium">
                    FECHA COMPROBANTE
                  </th>
                  <th className="border border-blue-700 px-2 py-1.5 text-left text-xs font-medium">NOMBRE FARMACIA</th>
                  <th className="border border-blue-700 px-2 py-1.5 text-left text-xs font-medium">PRODUCTOS</th>
                  <th className="border border-blue-700 px-2 py-1.5 text-center text-xs font-medium">
                    NIVEL DE CONFIANZA
                  </th>
                  <th className="border border-blue-700 px-2 py-1.5 text-center text-xs font-medium">ACCIONES</th>
                </tr>
              </thead>
              <tbody>
                {paginatedDocumentos.map((documento, index) => (
                  <tr
                    key={index}
                    className={
                      documento.estado === "procesando" ? "bg-blue-50" : index % 2 === 0 ? "bg-white" : "bg-blue-50"
                    }
                  >
                    {/* NÚMERO DE FACTURA cell */}
                    <td
                      className="border border-gray-300 px-2 py-1.5 text-xs cursor-pointer hover:bg-gray-100"
                      onDoubleClick={() =>
                        handleCellDoubleClick(
                          index,
                          "numeroFactura",
                          documento.numeroFactura || documento.numerofactura,
                        )
                      }
                      title="Doble clic para editar"
                    >
                      {documento.numeroFactura || documento.numerofactura}
                      {documento.estado === "procesando" && (
                        <div className="flex items-center mt-1">
                          <Loader2 className="h-3 w-3 animate-spin text-blue-600 mr-1" />
                          <span className="text-xs text-blue-600">Procesando</span>
                        </div>
                      )}
                    </td>

                    {/* FECHA COMPROBANTE cell */}
                    <td
                      className="border border-gray-300 px-2 py-1.5 text-xs cursor-pointer hover:bg-gray-100"
                      onDoubleClick={() => handleCellDoubleClick(index, "fechaComprobante", documento.fechaComprobante)}
                      title="Doble clic para editar"
                    >
                      {formatearFecha(documento.fechaComprobante)}
                      {documento.estado === "procesando" && (
                        <div className="flex items-center mt-1">
                          <Loader2 className="h-3 w-3 animate-spin text-blue-600 mr-1" />
                          <span className="text-xs text-blue-600">Procesando</span>
                        </div>
                      )}
                    </td>

                    {/* NOMBRE FARMACIA cell */}
                    <td
                      className="border border-gray-300 px-2 py-1.5 text-xs cursor-pointer hover:bg-gray-100"
                      onDoubleClick={() => handleCellDoubleClick(index, "nombreFarmacia", documento.nombreFarmacia)}
                      title="Doble clic para editar"
                    >
                      {documento.nombreFarmacia}
                      {documento.estado === "procesando" && (
                        <div className="flex items-center mt-1">
                          <Loader2 className="h-3 w-3 animate-spin text-blue-600 mr-1" />
                          <span className="text-xs text-blue-600">Procesando</span>
                        </div>
                      )}
                    </td>

                    {/* PRODUCTOS cell */}
                    <td className="border border-gray-300 px-2 py-1.5 text-xs">
                      <div className="max-w-xs">
                        {documento.productos && Array.isArray(documento.productos) ? (
                          <div className="space-y-2">
                            {documento.productos.map((producto, prodIndex) => (
                              <div key={prodIndex} className="text-xs border-b border-gray-200 pb-1 last:border-b-0">
                                <div className="font-medium text-blue-800">{producto.descripcion}</div>
                                <div className="font-medium text-blue-800">{producto.codigo_de_articulo}</div>
                                <div className="text-gray-600 mt-1">
                                  <span>Cant: {producto.cantidad}</span>
                                  {producto.precio_unitario ? (
                                    // Si tiene precio unitario, solo mostrar precio unitario
                                    <>
                                      <span className="mx-2">•</span>
                                      <span>Precio Unit: ${producto.precio_unitario}</span>
                                    </>
                                  ) : (
                                    // Si no tiene precio unitario, mostrar bruto, neto y subtotal
                                    <>
                                      {producto.precio_bruto && (
                                        <>
                                          <span className="mx-2">•</span>
                                          <span>Bruto: ${producto.precio_bruto}</span>
                                        </>
                                      )}
                                      {producto.precio_neto && (
                                        <>
                                          <span className="mx-2">•</span>
                                          <span>Neto: ${producto.precio_neto}</span>
                                        </>
                                      )}
                                      {producto.precio_subtotal && (
                                        <>
                                          <span className="mx-2">•</span>
                                          <span>Subtotal: ${producto.precio_subtotal}</span>
                                        </>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            ))}
                            {documento.totalFactura && (
                              <div className="text-xs font-bold text-green-700 border-t border-gray-300 pt-1 mt-2">
                                Total Factura: ${documento.totalFactura}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-500">Sin productos</span>
                        )}
                      </div>
                    </td>

                    {/* GRADO DE CONFIANZA cell */}
                    <td className="border border-gray-300 px-2 py-1.5 text-xs text-center">
                      {documento.promedio_confianza_textract ? `${documento.promedio_confianza_textract}%` : "N/A"}
                    </td>

                    {/* ACCIONES cell */}
                    <td className="border border-gray-300 px-2 py-1.5 text-xs text-center">
                      <div className="flex justify-center">
                        <button
                          onClick={() => handleViewDocument(documento)}
                          className="text-green-600 hover:text-green-800"
                          title="Ver documento"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          <div className="flex items-center justify-between mt-4">
            <div className="text-xs text-gray-500">
              Mostrando {paginatedDocumentos.length} de {documentos.length} documentos
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={goToPreviousPage}
                disabled={currentPage === 1}
                className="h-7 px-2"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs">
                Página {currentPage} de {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={goToNextPage}
                disabled={currentPage === totalPages}
                className="h-7 px-2"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Modal para visualizar documentos */}
        {viewerOpen && currentDocument && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex flex-col">
            <div className="bg-white w-full h-full flex flex-col">
              <div className="p-4 border-b flex justify-between items-center">
                <h3 className="text-lg font-medium">Visualización de documento</h3>
                <button onClick={handleCloseViewer} className="text-gray-500 hover:text-gray-700">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-2">
                {currentDocument.toLowerCase().endsWith(".pdf") ? (
                  <iframe src={currentDocument} className="w-full h-full border-0" title="Documento PDF" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <img
                      src={currentDocument || "/placeholder.svg"}
                      alt="Documento"
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>
                )}
              </div>
              <div className="p-4 border-t flex justify-end space-x-3">
                <Button
                  variant="outline"
                  className="bg-blue-100 text-blue-600 hover:bg-blue-200"
                  onClick={() => window.open(currentDocument, "_blank")}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Descargar
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Modal para editar campo */}
        {editModalOpen && editingField && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
            <div className="bg-white rounded-lg p-4 w-full max-w-md">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium">Editar {getFieldTitle(editingField.field)}</h3>
                <button
                  onClick={() => {
                    setEditModalOpen(false)
                    setEditingField(null)
                  }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mb-4">
                <Input
                  value={editingField.value}
                  onChange={(e) => handleEditFieldChange(e.target.value)}
                  className="w-full"
                  autoFocus
                />
              </div>

              <div className="flex justify-end space-x-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditModalOpen(false)
                    setEditingField(null)
                  }}
                  disabled={loading}
                >
                  Cancelar
                </Button>
                <Button onClick={handleSaveField} disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Guardando...
                    </>
                  ) : (
                    "Guardar"
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </RouteGuard>
  )
}

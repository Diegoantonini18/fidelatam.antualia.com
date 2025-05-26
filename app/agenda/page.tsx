"use client"

import { useRouter } from "next/navigation"
import { useState, useEffect } from "react"
import { AppHeader } from "@/components/app-header"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
// Importar el ícono de eliminación
import { Loader2, Search, UserPlus, Download, Pencil, Trash2, AlertTriangle } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import * as XLSX from "xlsx"
import { RouteGuard } from "@/components/route-guard"
import { Label } from "@/components/ui/label"
import { verifyToken, authenticatedFetch } from "@/utils/auth-utils"

// Función para generar ULIDs
function generateUlid() {
  const timestamp = Date.now().toString(16).padStart(12, "0")
  const randomPart = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("")
  return timestamp + randomPart
}

// Función para validar formato de número de teléfono para WhatsApp
function validarNumeroWhatsApp(numero: string): boolean {
  // Debe comenzar con + y luego solo contener dígitos
  const regex = /^\+[0-9]+$/
  return regex.test(numero)
}

// Función para formatear un número de teléfono para WhatsApp
function formatearNumeroWhatsApp(numero: string): string {
  // Eliminar todos los caracteres que no sean dígitos, excepto el +
  let formateado = numero.replace(/[^0-9+]/g, "")

  // Asegurarse de que comience con +
  if (!formateado.startsWith("+")) {
    formateado = "+" + formateado
  }

  return formateado
}

// Función para extraer valores de objetos DynamoDB
function extractDynamoDBValue(value: any): any {
  if (!value) return null

  // Si es un objeto con clave S, N, BOOL, etc.
  if (typeof value === "object") {
    if ("S" in value) return value.S
    if ("N" in value) return Number(value.N)
    if ("BOOL" in value) return value.BOOL
    if ("L" in value) return value.L.map(extractDynamoDBValue)
    if ("M" in value) {
      const result: Record<string, any> = {}
      Object.entries(value.M).forEach(([key, val]) => {
        result[key] = extractDynamoDBValue(val)
      })
      return result
    }
  }

  // Si es un array, procesar cada elemento
  if (Array.isArray(value)) {
    return value.map(extractDynamoDBValue)
  }

  // Si es un objeto normal, procesar cada propiedad
  if (typeof value === "object" && value !== null) {
    const result: Record<string, any> = {}
    Object.entries(value).forEach(([key, val]) => {
      result[key] = extractDynamoDBValue(val)
    })
    return result
  }

  // Valor primitivo
  return value
}

// Añadir una función para procesar las respuestas de error de la API
// Añadir esta función después de la función extractDynamoDBValue

// Función para extraer el mensaje de error de la respuesta de la API
const extraerMensajeError = async (response: Response): Promise<string> => {
  try {
    const data = await response.json()
    console.log("Respuesta de error completa:", data)

    // Verificar si la respuesta tiene el formato esperado con body-json y statusCode
    if (data && data["body-json"] && data["body-json"].statusCode === 409) {
      console.log("Detectado error 409 en body-json")

      // Intentar extraer el mensaje de error del body (que es un string JSON)
      try {
        const bodyError = JSON.parse(data["body-json"].body)
        if (bodyError.error) {
          return "Ya existe un contacto con estos datos. Por favor, utilice datos diferentes."
        }
      } catch (e) {
        console.error("Error al parsear el body:", e)
      }

      // Si no se pudo extraer el mensaje específico, usar uno genérico para 409
      return "Ya existe un contacto con estos datos. Por favor, utilice datos diferentes."
    }

    // Si el error no es 409 o no tiene el formato esperado, devolver un mensaje genérico
    return `Error en la operación. Por favor, inténtelo de nuevo.`
  } catch (e) {
    console.error("Error al procesar la respuesta:", e)
    // Si hay un error al procesar la respuesta, devolver un mensaje genérico
    return `Error en la operación. Por favor, inténtelo de nuevo.`
  }
}

// Modificar la interfaz Contacto para soportar múltiples emails y celulares
interface Contacto {
  id: string
  cliente: string
  mails: { id: string; value: string }[] // Añadido id para cada email
  celulares: { id: string; value: string }[] // Añadido id para cada celular
  sk?: string // Añadido para guardar el sk del cliente
}

export default function AgendaPage() {
  const router = useRouter()
  const [contactos, setContactos] = useState<Contacto[]>([])
  const [contactosFiltrados, setContactosFiltrados] = useState<Contacto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [filtro, setFiltro] = useState("")

  // Añadir estados para el modal de edición/creación
  const [modalOpen, setModalOpen] = useState(false)
  const [editingContact, setEditingContact] = useState<Contacto | null>(null)
  const [newMail, setNewMail] = useState("")
  const [newCelular, setNewCelular] = useState("")
  const [newCliente, setNewCliente] = useState("")
  const [isAddingEmail, setIsAddingEmail] = useState(false)
  const [isAddingCelular, setIsAddingCelular] = useState(false)
  const [celularError, setCelularError] = useState<string | null>(null)

  // Añadir estados para el modal de confirmación de eliminación
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteItem, setDeleteItem] = useState<{
    sk: string
    tipo: "cliente" | "email" | "celular"
    nombre: string
  } | null>(null)

  // Verificar autenticación al cargar la página
  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Verificar si el token es válido de manera estricta
        console.log("Verificando autenticación en página de agenda...")
        const isValid = await verifyToken()

        if (!isValid) {
          console.log("Token inválido o caducado en página de agenda, redirigiendo a login")
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

        // Obtener el token solo de localStorage
        const storedToken = localStorage.getItem("idToken")

        // Guardar el token
        setToken(storedToken)

        // Cargar datos reales desde la API
        fetchContactos()
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
  }, [])

  // Función para obtener los contactos desde la API
  const fetchContactos = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await authenticatedFetch("https://mbkhos7wyj.execute-api.us-east-1.amazonaws.com/prd/agenda")

      if (!response.ok) {
        throw new Error(`Error al obtener contactos: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      console.log("Datos de contactos recibidos:", data)

      // Procesar los datos recibidos
      let contactosFormateados: Contacto[] = []

      // Si la API devuelve datos, procesarlos
      if (data && data["body-json"] && data["body-json"].body) {
        try {
          let parsedBody: any

          // Parsear el body si es un string
          if (typeof data["body-json"].body === "string") {
            parsedBody = JSON.parse(data["body-json"].body)
          } else {
            parsedBody = data["body-json"].body
          }

          console.log("Parsed body:", parsedBody)

          // Crear un mapa para agrupar por cliente
          const clientesMap = new Map<string, Contacto>()

          // Primera pasada: identificar todos los clientes
          if (Array.isArray(parsedBody)) {
            parsedBody.forEach((item) => {
              // Extraer valores de los campos
              const pkgsi1 = typeof item.pkgsi1 === "object" && item.pkgsi1.S ? item.pkgsi1.S : item.pkgsi1
              const sk = typeof item.sk === "object" && item.sk.S ? item.sk.S : item.sk
              const skgsi1 = typeof item.skgsi1 === "object" && item.skgsi1.S ? item.skgsi1.S : item.skgsi1

              if (!sk) return

              // Verificar si es un registro de cliente por pkgsi1
              if (pkgsi1 === "cliente") {
                // Extraer el ID del cliente del sk
                const clienteId = sk.split("#")[1]

                clientesMap.set(sk, {
                  id: clienteId,
                  cliente: skgsi1 || "Cliente sin nombre",
                  sk: sk,
                  mails: [],
                  celulares: [],
                })
              }
            })

            // Segunda pasada: asignar emails y celulares a sus clientes
            parsedBody.forEach((item) => {
              // Extraer valores de los campos
              const pkgsi1 = typeof item.pkgsi1 === "object" && item.pkgsi1.S ? item.pkgsi1.S : item.pkgsi1
              const sk = typeof item.sk === "object" && item.sk.S ? item.sk.S : item.sk
              const skgsi1 = typeof item.skgsi1 === "object" && item.skgsi1.S ? item.skgsi1.S : item.skgsi1

              if (!sk) return

              // Si es un email (pkgsi1 === "mail")
              if (pkgsi1 === "mail") {
                // Extraer el sk del cliente del sk del email
                const clienteSk = sk.split("#mail#")[0]

                // Buscar el cliente correspondiente
                const cliente = clientesMap.get(clienteSk)

                if (cliente) {
                  cliente.mails.push({
                    id: sk,
                    value: skgsi1 || "",
                  })
                }
              }
              // Si es un celular (pkgsi1 === "numero")
              else if (pkgsi1 === "numero") {
                // Extraer el sk del cliente del sk del celular
                const clienteSk = sk.split("#numero#")[0]

                // Buscar el cliente correspondiente
                const cliente = clientesMap.get(clienteSk)

                if (cliente) {
                  cliente.celulares.push({
                    id: sk,
                    value: skgsi1 || "",
                  })
                }
              }
            })

            contactosFormateados = Array.from(clientesMap.values())
          }
        } catch (parseError) {
          console.error("Error al procesar datos de contactos:", parseError)
          throw new Error("Error al procesar la respuesta del servidor")
        }
      }

      console.log("Contactos formateados:", contactosFormateados)
      setContactos(contactosFormateados)
      setContactosFiltrados(contactosFormateados)
    } catch (err) {
      console.error("Error al obtener contactos:", err)
      setError(err instanceof Error ? err.message : "Error al cargar los contactos")

      // Si no hay datos, usar datos de ejemplo para desarrollo
      cargarDatosDeEjemplo()
    } finally {
      setLoading(false)
    }
  }

  // Datos de ejemplo para desarrollo
  const cargarDatosDeEjemplo = () => {
    const datosEjemplo: Contacto[] = [
      {
        id: "1",
        cliente: "Empresa ABC",
        sk: "cliente#1",
        mails: [
          { id: "mail#1", value: "contacto@empresaabc.com" },
          { id: "mail#2", value: "ventas@empresaabc.com" },
        ],
        celulares: [
          { id: "numero#1", value: "+54 9 11 1234-5678" },
          { id: "numero#2", value: "+54 9 11 8765-4321" },
        ],
      },
      {
        id: "2",
        cliente: "Distribuidora XYZ",
        sk: "cliente#2",
        mails: [{ id: "mail#3", value: "info@distribuidoraxyz.com" }],
        celulares: [{ id: "numero#3", value: "+54 9 11 8765-4321" }],
      },
      {
        id: "3",
        cliente: "Comercial Norte",
        sk: "cliente#3",
        mails: [
          { id: "mail#4", value: "ventas@comercialnorte.com" },
          { id: "mail#5", value: "admin@comercialnorte.com" },
        ],
        celulares: [{ id: "numero#4", value: "+54 9 351 234-5678" }],
      },
    ]

    setContactos(datosEjemplo)
    setContactosFiltrados(datosEjemplo)
  }

  // Modificar la función crearContacto para manejar el error 409
  const crearContacto = async (nombre: string, email?: string, celular?: string) => {
    if (!nombre) {
      setError("El nombre del cliente es obligatorio")
      return false
    }

    // Validar el formato del número de celular si se proporciona
    if (celular) {
      if (!validarNumeroWhatsApp(celular)) {
        setError("El número debe comenzar con + seguido solo de números, sin espacios ni guiones")
        return false
      }
    }

    try {
      setLoading(true)

      // Generar ULID para el cliente
      const clienteUlid = generateUlid()
      const skCliente = `cliente#${clienteUlid}`

      // Crear el cliente
      const clienteResponse = await authenticatedFetch(
        "https://mbkhos7wyj.execute-api.us-east-1.amazonaws.com/prd/agenda",
        {
          method: "POST",
          body: JSON.stringify({
            sk: skCliente,
            pkgsi1: "cliente",
            skgsi1: nombre,
          }),
        },
      )

      // Obtener la respuesta completa
      const responseData = await clienteResponse.clone().json()
      console.log("Respuesta completa:", responseData)

      // Verificar si hay un error 409 en body-json
      if (responseData["body-json"] && responseData["body-json"].statusCode === 409) {
        const mensajeError = await extraerMensajeError(clienteResponse.clone())
        throw new Error(mensajeError)
      }

      // Si no es un error 409 pero la respuesta no es ok
      if (!clienteResponse.ok) {
        throw new Error(`Error al crear cliente: ${clienteResponse.status}`)
      }

      console.log("Cliente creado exitosamente")

      // Si se proporcionó un email, crearlo
      if (email) {
        const emailUlid = generateUlid()
        const skEmail = `${skCliente}#mail#${emailUlid}`

        const emailResponse = await authenticatedFetch(
          "https://mbkhos7wyj.execute-api.us-east-1.amazonaws.com/prd/agenda",
          {
            method: "POST",
            body: JSON.stringify({
              sk: skEmail,
              pkgsi1: "mail",
              skgsi1: email,
            }),
          },
        )

        if (!emailResponse.ok) {
          // Verificar si es un error 409
          try {
            const emailData = await emailResponse.clone().json()
            if (emailData["body-json"] && emailData["body-json"].statusCode === 409) {
              console.warn("El email ya existe, pero el cliente se creó correctamente")
            } else {
              console.error("Error al crear email:", emailResponse.status)
            }
          } catch (e) {
            console.error("Error al procesar respuesta de email:", e)
          }
        } else {
          console.log("Email creado exitosamente")
        }
      }

      // Si se proporcionó un celular, crearlo
      if (celular) {
        const celularUlid = generateUlid()
        const skCelular = `${skCliente}#numero#${celularUlid}`

        const celularResponse = await authenticatedFetch(
          "https://mbkhos7wyj.execute-api.us-east-1.amazonaws.com/prd/agenda",
          {
            method: "POST",
            body: JSON.stringify({
              sk: skCelular,
              pkgsi1: "numero",
              skgsi1: celular,
            }),
          },
        )

        if (!celularResponse.ok) {
          // Verificar si es un error 409
          try {
            const celularData = await celularResponse.clone().json()
            if (celularData["body-json"] && celularData["body-json"].statusCode === 409) {
              console.warn("El celular ya existe, pero el cliente se creó correctamente")
            } else {
              console.error("Error al crear celular:", celularResponse.status)
            }
          } catch (e) {
            console.error("Error al procesar respuesta de celular:", e)
          }
        } else {
          console.log("Celular creado exitosamente")
        }
      }

      // Recargar los contactos
      await fetchContactos()
      return true
    } catch (err) {
      console.error("Error al crear contacto:", err)
      setError(err instanceof Error ? err.message : "Error al crear el contacto")
      return false
    } finally {
      setLoading(false)
    }
  }

  // Modificar la función editarNombreContacto para manejar el error 409
  const editarNombreContacto = async (sk: string, nuevoNombre: string) => {
    if (!sk || !nuevoNombre) {
      setError("Se requiere el identificador del contacto y el nuevo nombre")
      return false
    }

    try {
      setLoading(true)

      const response = await authenticatedFetch("https://mbkhos7wyj.execute-api.us-east-1.amazonaws.com/prd/agenda", {
        method: "POST",
        body: JSON.stringify({
          sk: sk,
          skgsi1: nuevoNombre,
        }),
      })

      // Obtener la respuesta completa
      const responseData = await response.clone().json()
      console.log("Respuesta completa:", responseData)

      // Verificar si hay un error 409 en body-json
      if (responseData["body-json"] && responseData["body-json"].statusCode === 409) {
        const mensajeError = await extraerMensajeError(response.clone())
        throw new Error(mensajeError)
      }

      // Si no es un error 409 pero la respuesta no es ok
      if (!response.ok) {
        throw new Error(`Error al actualizar contacto: ${response.status}`)
      }

      console.log("Contacto actualizado exitosamente")

      // Recargar los contactos
      await fetchContactos()
      return true
    } catch (err) {
      console.error("Error al actualizar contacto:", err)
      setError(err instanceof Error ? err.message : "Error al actualizar el contacto")
      return false
    } finally {
      setLoading(false)
    }
  }

  // Modificar la función agregarEmailContacto para manejar el error 409
  const agregarEmailContacto = async (skCliente: string, email: string) => {
    if (!skCliente || !email) {
      setError("Se requiere el identificador del contacto y el email")
      return false
    }

    try {
      setLoading(true)

      // Generar ULID para el email
      const emailUlid = generateUlid()
      const skEmail = `${skCliente}#mail#${emailUlid}`

      const response = await authenticatedFetch("https://mbkhos7wyj.execute-api.us-east-1.amazonaws.com/prd/agenda", {
        method: "POST",
        body: JSON.stringify({
          sk: skEmail,
          pkgsi1: "mail",
          skgsi1: email,
        }),
      })

      // Obtener la respuesta completa
      const responseData = await response.clone().json()
      console.log("Respuesta completa:", responseData)

      // Verificar si hay un error 409 en body-json
      if (responseData["body-json"] && responseData["body-json"].statusCode === 409) {
        const mensajeError = await extraerMensajeError(response.clone())
        throw new Error(mensajeError)
      }

      // Si no es un error 409 pero la respuesta no es ok
      if (!response.ok) {
        throw new Error(`Error al agregar email: ${response.status}`)
      }

      console.log("Email agregado exitosamente")

      // Recargar los contactos
      await fetchContactos()
      return true
    } catch (err) {
      console.error("Error al agregar email:", err)
      setError(err instanceof Error ? err.message : "Error al agregar el email")
      return false
    } finally {
      setLoading(false)
    }
  }

  // Modificar la función agregarCelularContacto para manejar el error 409
  const agregarCelularContacto = async (skCliente: string, celular: string) => {
    if (!skCliente || !celular) {
      setError("Se requiere el identificador del contacto y el celular")
      return false
    }

    // Validar el formato del número
    if (!validarNumeroWhatsApp(celular)) {
      setError("El número debe comenzar con + seguido solo de números, sin espacios ni guiones")
      return false
    }

    try {
      setLoading(true)

      // Generar ULID para el celular
      const celularUlid = generateUlid()
      const skCelular = `${skCliente}#numero#${celularUlid}`

      const response = await authenticatedFetch("https://mbkhos7wyj.execute-api.us-east-1.amazonaws.com/prd/agenda", {
        method: "POST",
        body: JSON.stringify({
          sk: skCelular,
          pkgsi1: "numero",
          skgsi1: celular,
        }),
      })

      // Obtener la respuesta completa
      const responseData = await response.clone().json()
      console.log("Respuesta completa:", responseData)

      // Verificar si hay un error 409 en body-json
      if (responseData["body-json"] && responseData["body-json"].statusCode === 409) {
        const mensajeError = await extraerMensajeError(response.clone())
        throw new Error(mensajeError)
      }

      // Si no es un error 409 pero la respuesta no es ok
      if (!response.ok) {
        throw new Error(`Error al agregar celular: ${response.status}`)
      }

      console.log("Celular agregado exitosamente")

      // Recargar los contactos
      await fetchContactos()
      return true
    } catch (err) {
      console.error("Error al agregar celular:", err)
      setError(err instanceof Error ? err.message : "Error al agregar el celular")
      return false
    } finally {
      setLoading(false)
    }
  }

  // Modificar la función editarEmail para manejar el error 409
  const editarEmail = async (skEmail: string, nuevoEmail: string) => {
    if (!skEmail || !nuevoEmail) {
      setError("Se requiere el identificador del email y el nuevo valor")
      return false
    }

    try {
      setLoading(true)

      const response = await authenticatedFetch("https://mbkhos7wyj.execute-api.us-east-1.amazonaws.com/prd/agenda", {
        method: "POST",
        body: JSON.stringify({
          sk: skEmail,
          skgsi1: nuevoEmail,
        }),
      })

      if (!response.ok) {
        // Si es un error 409, mostrar mensaje específico
        if (response.status === 409) {
          const mensajeError = await extraerMensajeError(response)
          throw new Error(mensajeError)
        }
        throw new Error(`Error al actualizar email: ${response.status}`)
      }

      console.log("Email actualizado exitosamente")

      // Recargar los contactos
      await fetchContactos()
      return true
    } catch (err) {
      console.error("Error al actualizar email:", err)
      setError(err instanceof Error ? err.message : "Error al actualizar el email")
      return false
    } finally {
      setLoading(false)
    }
  }

  // Modificar la función editarCelular para manejar el error 409
  const editarCelular = async (skCelular: string, nuevoCelular: string) => {
    if (!skCelular || !nuevoCelular) {
      setError("Se requiere el identificador del celular y el nuevo valor")
      return false
    }

    // Validar el formato del número
    if (!validarNumeroWhatsApp(nuevoCelular)) {
      setError("El número debe comenzar con + seguido solo de números, sin espacios ni guiones")
      return false
    }

    try {
      setLoading(true)

      const response = await authenticatedFetch("https://mbkhos7wyj.execute-api.us-east-1.amazonaws.com/prd/agenda", {
        method: "POST",
        body: JSON.stringify({
          sk: skCelular,
          skgsi1: nuevoCelular,
        }),
      })

      if (!response.ok) {
        // Si es un error 409, mostrar mensaje específico
        if (response.status === 409) {
          const mensajeError = await extraerMensajeError(response)
          throw new Error(mensajeError)
        }
        throw new Error(`Error al actualizar celular: ${response.status}`)
      }

      console.log("Celular actualizado exitosamente")

      // Recargar los contactos
      await fetchContactos()
      return true
    } catch (err) {
      console.error("Error al actualizar celular:", err)
      setError(err instanceof Error ? err.message : "Error al actualizar el celular")
      return false
    } finally {
      setLoading(false)
    }
  }

  // Actualizar la función de filtrado para buscar en arrays
  const filtrarContactos = (texto: string) => {
    setFiltro(texto)

    if (!texto.trim()) {
      setContactosFiltrados(contactos)
      return
    }

    const textoLower = texto.toLowerCase()
    const filtrados = contactos.filter(
      (contacto) =>
        contacto.cliente.toLowerCase().includes(textoLower) ||
        contacto.mails.some((mail) => mail.value.toLowerCase().includes(textoLower)) ||
        contacto.celulares.some((celular) => celular.value.toLowerCase().includes(textoLower)),
    )

    setContactosFiltrados(filtrados)
  }

  // Actualizar la función de exportación a Excel
  const exportarExcel = () => {
    try {
      // Crear una copia de los datos filtrados para la exportación
      // Aplanar los datos para Excel (un contacto por cada combinación de email y celular)
      const dataToExport = []

      contactosFiltrados.forEach((contacto) => {
        // Para cada contacto, crear una entrada por cada email y celular
        if (contacto.mails.length === 0 && contacto.celulares.length === 0) {
          // Si no tiene emails ni celulares, crear una entrada solo con el nombre
          dataToExport.push({
            CLIENTE: contacto.cliente,
            EMAIL: "",
            CELULAR: "",
          })
        } else {
          // Si tiene emails o celulares, crear entradas para cada combinación
          const mails = contacto.mails.length > 0 ? contacto.mails : [{ id: "", value: "" }]
          const celulares = contacto.celulares.length > 0 ? contacto.celulares : [{ id: "", value: "" }]

          mails.forEach((mail) => {
            celulares.forEach((celular) => {
              dataToExport.push({
                CLIENTE: contacto.cliente,
                EMAIL: mail.value,
                CELULAR: celular.value,
              })
            })
          })
        }
      })

      // Crear un libro de trabajo y una hoja
      const ws = XLSX.utils.json_to_sheet(dataToExport)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, "Contactos")

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
      const nombreArchivo = `agenda_contactos_${fechaActual}.xlsx`

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

  // Función para abrir el modal de nuevo contacto
  const handleNewContact = () => {
    setEditingContact(null)
    setNewCliente("")
    setNewMail("")
    setNewCelular("")
    setIsAddingEmail(false)
    setIsAddingCelular(false)
    setCelularError(null)
    setModalOpen(true)
  }

  // Función para abrir el modal de edición
  const handleEditContact = (contacto: Contacto) => {
    setEditingContact(contacto)
    setNewCliente(contacto.cliente)
    setNewMail("")
    setNewCelular("")
    setIsAddingEmail(false)
    setIsAddingCelular(false)
    setCelularError(null)
    setModalOpen(true)
  }

  // Función para agregar un nuevo email a un contacto
  const handleAddEmail = (contacto: Contacto) => {
    setEditingContact(contacto)
    setNewMail("")
    setIsAddingEmail(true)
    setIsAddingCelular(false)
    setCelularError(null)
    setModalOpen(true)
  }

  // Función para agregar un nuevo celular a un contacto
  const handleAddCelular = (contacto: Contacto) => {
    setEditingContact(contacto)
    setNewCelular("")
    setIsAddingEmail(false)
    setIsAddingCelular(true)
    setCelularError(null)
    setModalOpen(true)
  }

  // Función para validar el número de celular
  const validarCelular = (numero: string): boolean => {
    if (!numero) return true // Permitir vacío

    // Formatear el número
    const formateado = formatearNumeroWhatsApp(numero)

    // Validar el formato
    if (!validarNumeroWhatsApp(formateado)) {
      setCelularError("El número debe comenzar con + seguido solo de números, sin espacios ni guiones")
      return false
    }

    setCelularError(null)
    return true
  }

  // Función para guardar un nuevo contacto o actualizar uno existente
  const handleSaveContact = async () => {
    // Validar que el nombre del cliente sea obligatorio
    if (!newCliente && !editingContact) {
      setError("El nombre del cliente es obligatorio")
      return
    }

    // Validar el formato del celular si se proporciona
    if (newCelular) {
      const formateado = formatearNumeroWhatsApp(newCelular)
      if (!validarNumeroWhatsApp(formateado)) {
        setCelularError("El número debe comenzar con + seguido solo de números, sin espacios ni guiones")
        return
      }
    }

    try {
      setLoading(true)
      let success = false

      if (editingContact) {
        // Estamos editando un contacto existente
        if (isAddingEmail) {
          // Agregar nuevo email
          success = await agregarEmailContacto(editingContact.sk || "", newMail)
        } else if (isAddingCelular) {
          // Formatear el número antes de agregarlo
          const celularFormateado = formatearNumeroWhatsApp(newCelular)

          // Agregar nuevo celular
          success = await agregarCelularContacto(editingContact.sk || "", celularFormateado)
        } else {
          // Actualizar nombre del contacto
          success = await editarNombreContacto(editingContact.sk || "", newCliente)
        }
      } else {
        // Crear nuevo contacto
        const celularFormateado = newCelular ? formatearNumeroWhatsApp(newCelular) : undefined
        success = await crearContacto(newCliente, newMail, celularFormateado)
      }

      if (success) {
        setModalOpen(false)
      }
    } catch (err) {
      console.error("Error al guardar contacto:", err)
      setError(err instanceof Error ? err.message : "Error al guardar el contacto")
    } finally {
      setLoading(false)
    }
  }

  // Añadir una función para eliminar elementos (cliente, email o celular)
  const eliminarElemento = async (sk: string, tipo: "cliente" | "email" | "celular") => {
    if (!sk) {
      setError("No se pudo identificar el elemento a eliminar")
      return false
    }

    try {
      setLoading(true)

      // Llamar a la API de eliminación
      const response = await authenticatedFetch(
        "https://mbkhos7wyj.execute-api.us-east-1.amazonaws.com/prd/agenda/eliminar_contactos",
        {
          method: "POST",
          body: JSON.stringify({
            sk: sk,
          }),
        },
      )

      if (!response.ok) {
        throw new Error(`Error al eliminar ${tipo}: ${response.status}`)
      }

      console.log(`${tipo} eliminado exitosamente`)

      // Recargar los contactos
      await fetchContactos()
      return true
    } catch (err) {
      console.error(`Error al eliminar ${tipo}:`, err)
      setError(err instanceof Error ? err.message : `Error al eliminar ${tipo}`)
      return false
    } finally {
      setLoading(false)
    }
  }

  // Añadir funciones para manejar la eliminación
  const handleDeleteClient = (contacto: Contacto) => {
    setDeleteItem({
      sk: contacto.sk || "",
      tipo: "cliente",
      nombre: contacto.cliente,
    })
    setDeleteModalOpen(true)
  }

  const handleDeleteEmail = (email: { id: string; value: string }) => {
    setDeleteItem({
      sk: email.id,
      tipo: "email",
      nombre: email.value,
    })
    setDeleteModalOpen(true)
  }

  const handleDeleteCelular = (celular: { id: string; value: string }) => {
    setDeleteItem({
      sk: celular.id,
      tipo: "celular",
      nombre: celular.value,
    })
    setDeleteModalOpen(true)
  }

  const confirmDelete = async () => {
    if (!deleteItem) return

    const success = await eliminarElemento(deleteItem.sk, deleteItem.tipo)
    if (success) {
      setDeleteModalOpen(false)
      setDeleteItem(null)
    }
  }

  // Si no hay token, mostrar indicador de carga
  if (!token) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p>Verificando autenticación...</p>
        </div>
      </div>
    )
  }

  return (
    <RouteGuard>
      <div className="min-h-screen bg-white">
        <AppHeader title="Agenda de Contactos" />
        {/* Resto del contenido de la página */}
        <div className="p-4 text-base">
          <div className="flex flex-col md:flex-row gap-2 mb-4 items-start flex-wrap">
            <div className="w-full md:w-1/3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  type="text"
                  placeholder="Buscar por cliente, email o celular..."
                  className="pl-10"
                  value={filtro}
                  onChange={(e) => filtrarContactos(e.target.value)}
                />
              </div>
            </div>
            <div className="w-full md:w-auto md:flex-shrink-0 flex gap-2 md:ml-auto">
              <Button
                variant="outline"
                className="bg-green-100 text-green-600 hover:bg-green-200"
                onClick={exportarExcel}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Cargando...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Exportar Excel
                  </>
                )}
              </Button>
              <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleNewContact}>
                <UserPlus className="mr-2 h-4 w-4" />
                Nuevo Contacto
              </Button>
            </div>
          </div>

          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex justify-center items-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                <span className="ml-2">Cargando contactos...</span>
              </div>
            ) : contactosFiltrados.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                {filtro ? "No se encontraron contactos con ese criterio de búsqueda" : "No hay contactos disponibles"}
              </div>
            ) : (
              <table className="w-full border-collapse rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-blue-600 text-white">
                    <th className="border border-blue-700 px-3 py-2.5 text-left text-sm font-medium">CLIENTE</th>
                    <th className="border border-blue-700 px-3 py-2.5 text-left text-sm font-medium">EMAILS</th>
                    <th className="border border-blue-700 px-3 py-2.5 text-left text-sm font-medium">CELULARES</th>
                    <th className="border border-blue-700 px-3 py-2.5 text-center text-sm font-medium">ACCIONES</th>
                  </tr>
                </thead>
                <tbody>
                  {contactosFiltrados.map((contacto, index) => (
                    <tr key={contacto.id} className={index % 2 === 0 ? "bg-white" : "bg-blue-50"}>
                      <td className="border border-gray-300 px-3 py-2.5 text-sm">{contacto.cliente}</td>
                      <td className="border border-gray-300 px-3 py-2.5 text-sm">
                        <div className="flex flex-col space-y-1">
                          {contacto.mails.map((mail, idx) => (
                            <div key={idx} className="flex items-center justify-between">
                              <a href={`mailto:${mail.value}`} className="text-blue-600 hover:underline">
                                {mail.value}
                              </a>
                              <button
                                onClick={() => handleDeleteEmail(mail)}
                                className="text-red-500 hover:text-red-700 ml-2"
                                title="Eliminar email"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={() => handleAddEmail(contacto)}
                            className="text-xs text-green-600 hover:text-green-800 mt-1 flex items-center"
                          >
                            <span className="mr-1">+</span> Agregar email
                          </button>
                        </div>
                      </td>
                      <td className="border border-gray-300 px-3 py-2.5 text-sm">
                        <div className="flex flex-col space-y-1">
                          {contacto.celulares.map((celular, idx) => (
                            <div key={idx} className="flex items-center justify-between">
                              <a
                                href={`https://wa.me/${celular.value.replace(/\+/g, "")}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                {celular.value}
                              </a>
                              <button
                                onClick={() => handleDeleteCelular(celular)}
                                className="text-red-500 hover:text-red-700 ml-2"
                                title="Eliminar celular"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={() => handleAddCelular(contacto)}
                            className="text-xs text-green-600 hover:text-green-800 mt-1 flex items-center"
                          >
                            <span className="mr-1">+</span> Agregar celular
                          </button>
                        </div>
                      </td>
                      <td className="border border-gray-300 px-3 py-2.5 text-sm text-center">
                        <div className="flex justify-center space-x-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditContact(contacto)}
                            className="text-blue-600 hover:text-blue-800"
                            title="Editar contacto"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteClient(contacto)}
                            className="text-red-600 hover:text-red-800"
                            title="Eliminar contacto"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Modal para agregar/editar contactos */}
        {modalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <h3 className="text-lg font-medium mb-4">
                {editingContact
                  ? isAddingEmail
                    ? "Agregar Email"
                    : isAddingCelular
                      ? "Agregar Celular"
                      : "Editar Contacto"
                  : "Nuevo Contacto"}
              </h3>

              <div className="space-y-4">
                {/* Campo Cliente (solo editable si es nuevo contacto o edición general) */}
                {(!editingContact || (!isAddingEmail && !isAddingCelular)) && (
                  <div>
                    <Label htmlFor="cliente">
                      Cliente <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="cliente"
                      value={newCliente}
                      onChange={(e) => setNewCliente(e.target.value)}
                      placeholder="Nombre del cliente"
                      required
                    />
                  </div>
                )}

                {/* Campo Email (solo visible si es nuevo contacto o agregando email) */}
                {(!editingContact || isAddingEmail) && (
                  <div>
                    <Label htmlFor="email">
                      Email {!editingContact && <span className="text-gray-500">(opcional)</span>}
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      value={newMail}
                      onChange={(e) => setNewMail(e.target.value)}
                      placeholder="Correo electrónico"
                    />
                  </div>
                )}

                {/* Campo Celular (solo visible si es nuevo contacto o agregando celular) */}
                {(!editingContact || isAddingCelular) && (
                  <div>
                    <Label htmlFor="celular">
                      Celular {!editingContact && <span className="text-gray-500">(opcional)</span>}
                    </Label>
                    <Input
                      id="celular"
                      value={newCelular}
                      onChange={(e) => {
                        setNewCelular(e.target.value)
                        validarCelular(e.target.value)
                      }}
                      placeholder="+541112345678"
                      className={`mb-1 ${celularError ? "border-red-500" : ""}`}
                    />
                    <p className="text-xs text-gray-500">
                      Escribir número tal cual aparece en WhatsApp (con + y sin espacios ni guiones)
                    </p>
                    {celularError && <p className="text-xs text-red-500 mt-1">{celularError}</p>}
                  </div>
                )}
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <Button variant="outline" onClick={() => setModalOpen(false)} disabled={loading}>
                  Cancelar
                </Button>
                <Button onClick={handleSaveContact} disabled={loading || (newCelular !== "" && celularError !== null)}>
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
        {/* Modal de confirmación de eliminación */}
        {deleteModalOpen && deleteItem && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <div className="flex items-center text-red-600 mb-4">
                <AlertTriangle className="h-6 w-6 mr-2" />
                <h3 className="text-lg font-medium">Confirmar eliminación</h3>
              </div>

              <p className="mb-6">
                {deleteItem.tipo === "cliente"
                  ? `¿Está seguro que desea eliminar el cliente "${deleteItem.nombre}" y todos sus datos asociados?`
                  : `¿Está seguro que desea eliminar ${deleteItem.tipo === "email" ? "el email" : "el celular"} "${deleteItem.nombre}"?`}
              </p>

              <div className="flex justify-end space-x-3">
                <Button variant="outline" onClick={() => setDeleteModalOpen(false)} disabled={loading}>
                  Cancelar
                </Button>
                <Button variant="destructive" onClick={confirmDelete} disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Eliminando...
                    </>
                  ) : (
                    "Eliminar"
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

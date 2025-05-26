import { CognitoUserPool } from "amazon-cognito-identity-js"

// Configuración de Cognito
const poolData = {
  UserPoolId: "us-east-1_tY3372P8t",
  ClientId: "74j6ahmpqbco9uaaonj5qpfaag",
}

const userPool = new CognitoUserPool(poolData)

/**
 * Verifica si el token de autenticación es válido
 * @returns Promise<boolean> - true si el token es válido, false si no lo es
 */
export const verifyToken = (): Promise<boolean> => {
  return new Promise((resolve) => {
    try {
      const currentUser = userPool.getCurrentUser()
      const storedToken = localStorage.getItem("idToken")

      // Si no hay usuario o token, el token no es válido
      if (!currentUser || !storedToken) {
        console.log("No hay usuario o token almacenado")
        resolve(false)
        return
      }

      // Verificar la sesión con Cognito de manera más estricta
      currentUser.getSession((err: Error | null, session: any) => {
        if (err) {
          console.error("Error al verificar la sesión:", err)
          resolve(false)
          return
        }

        if (!session) {
          console.log("No se pudo obtener la sesión")
          resolve(false)
          return
        }

        // Verificar explícitamente si la sesión es válida
        if (!session.isValid()) {
          console.log("La sesión ha caducado")
          resolve(false)
          return
        }

        // Verificar que el token en localStorage coincida con el token de la sesión
        const sessionToken = session.getIdToken().getJwtToken()
        if (sessionToken !== storedToken) {
          console.log("El token almacenado no coincide con el token de la sesión")
          resolve(false)
          return
        }

        // La sesión es válida
        console.log("Sesión válida")
        resolve(true)
      })
    } catch (error) {
      console.error("Error al verificar el token:", error)
      resolve(false)
    }
  })
}

/**
 * Redirige al usuario a la página de login si el token no es válido
 */
export const redirectToLoginIfInvalidToken = async () => {
  const isValid = await verifyToken()

  if (!isValid) {
    console.log("Token inválido, redirigiendo a login")
    // Limpiar el token
    localStorage.removeItem("idToken")
    // Redirigir a login
    window.location.href = "/login"
    return false
  }

  return true
}

/**
 * Wrapper para fetch que verifica la validez del token antes de hacer la solicitud
 * @param url - URL de la solicitud
 * @param options - Opciones de fetch
 * @returns Promise<Response> - Respuesta de fetch
 */
export const authenticatedFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  // Verificar si el token es válido
  const isValid = await verifyToken()

  if (!isValid) {
    console.log("Token inválido, redirigiendo a login")
    // Limpiar el token
    localStorage.removeItem("idToken")
    // Redirigir a login
    window.location.href = "/login"
    throw new Error("Token inválido")
  }

  // Si el token es válido, continuar con la solicitud
  const token = localStorage.getItem("idToken")

  // Asegurarse de que options.headers exista
  const headers = options.headers || {}

  // Añadir el token a los headers
  const newOptions = {
    ...options,
    headers: {
      ...headers,
      auth: token,
      "Content-Type": "application/json",
    },
  }

  return fetch(url, newOptions)
}

"use client"

import { useEffect, useState, type ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { verifyToken } from "@/utils/auth-utils"

interface RouteGuardProps {
  children: ReactNode
}

export function RouteGuard({ children }: RouteGuardProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const checkAuth = async () => {
      try {
        console.log("Verificando autenticación en RouteGuard...")
        const isValid = await verifyToken()

        if (!isValid) {
          console.log("Token inválido o caducado en RouteGuard, redirigiendo a login")
          // Limpiar todas las credenciales de Cognito del localStorage
          localStorage.removeItem("idToken")

          // Buscar y eliminar todas las claves relacionadas con Cognito
          Object.keys(localStorage).forEach((key) => {
            if (key.startsWith("CognitoIdentityServiceProvider")) {
              localStorage.removeItem(key)
            }
          })

          // Forzar redirección a login
          window.location.href = "/login"
          return
        }

        console.log("Usuario autenticado en RouteGuard")
        setIsAuthenticated(true)
        setIsLoading(false)
      } catch (error) {
        console.error("Error verificando autenticación en RouteGuard:", error)
        // Limpiar todas las credenciales de Cognito del localStorage
        localStorage.removeItem("idToken")

        // Buscar y eliminar todas las claves relacionadas con Cognito
        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith("CognitoIdentityServiceProvider")) {
            localStorage.removeItem(key)
          }
        })

        window.location.href = "/login"
      }
    }

    checkAuth()

    // Configurar una verificación periódica de la autenticación
    const interval = setInterval(async () => {
      const isStillValid = await verifyToken()
      if (!isStillValid && isAuthenticated) {
        console.log("Token expirado durante la sesión, redirigiendo a login")
        // Limpiar todas las credenciales de Cognito del localStorage
        localStorage.removeItem("idToken")

        // Buscar y eliminar todas las claves relacionadas con Cognito
        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith("CognitoIdentityServiceProvider")) {
            localStorage.removeItem(key)
          }
        })

        window.location.href = "/login"
      }
    }, 60000) // Verificar cada minuto

    return () => clearInterval(interval)
  }, [isAuthenticated])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p>Verificando autenticación...</p>
        </div>
      </div>
    )
  }

  return isAuthenticated ? <>{children}</> : null
}

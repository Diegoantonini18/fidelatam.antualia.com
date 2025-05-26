"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { AuthenticationDetails, CognitoUser, CognitoUserPool } from "amazon-cognito-identity-js"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"

// Configuración de Cognito
const poolData = {
  UserPoolId: "us-east-1_tY3372P8t",
  ClientId: "74j6ahmpqbco9uaaonj5qpfaag",
}

const userPool = new CognitoUserPool(poolData)

export default function LoginPage() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Verificar si ya está autenticado al cargar la página
  useEffect(() => {
    const checkAuth = () => {
      const storedToken = localStorage.getItem("idToken")
      const currentUser = userPool.getCurrentUser()

      if (storedToken && currentUser) {
        // Si ya está autenticado, redirigir a la página principal
        window.location.href = "/"
      }
    }

    checkAuth()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const authenticationData = {
      Username: username,
      Password: password,
    }

    const authenticationDetails = new AuthenticationDetails(authenticationData)

    const userData = {
      Username: username,
      Pool: userPool,
    }

    const cognitoUser = new CognitoUser(userData)

    cognitoUser.authenticateUser(authenticationDetails, {
      onSuccess: (result) => {
        console.log("Login exitoso")

        try {
          // Guardar token solo en localStorage
          const idToken = result.getIdToken().getJwtToken()
          localStorage.setItem("idToken", idToken)
          console.log("Token guardado en localStorage:", idToken.substring(0, 20) + "...")

          // Usar window.location.href para forzar una recarga completa
          window.location.href = "/"
        } catch (err) {
          console.error("Error guardando token:", err)
          setError("Error al guardar la sesión. Por favor, inténtelo de nuevo.")
          setLoading(false)
        }
      },
      onFailure: (err) => {
        console.error("Error en login", err)
        setError(err.message || "Ha ocurrido un error durante el inicio de sesión")
        setLoading(false)
      },
      newPasswordRequired: (userAttributes, requiredAttributes) => {
        // Manejar el caso de contraseña temporal que requiere cambio
        console.log("Se requiere cambio de contraseña")
        setError("Se requiere cambiar la contraseña. Por favor contacte al administrador.")
        setLoading(false)
      },
    })
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="w-full max-w-md p-8 space-y-8 bg-white rounded-lg shadow-lg">
        <div className="text-center">
          <h2 className="text-2xl font-semibold mb-4">Iniciar Sesión</h2>
          <img src="/images/fidelatam-logo.png" alt="Fidelatam Logo" className="h-60 mx-auto mb-4" />
          <p className="mt-2 text-gray-600">Ingrese sus credenciales para acceder al sistema</p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          <div className="space-y-4">
            <div>
              <Label htmlFor="username">Usuario</Label>
              <Input
                id="username"
                name="username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1"
                placeholder="Ingrese su usuario"
              />
            </div>
            <div>
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1"
                placeholder="Ingrese su contraseña"
              />
            </div>
          </div>

          <div>
            <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" disabled={loading}>
              {loading ? "Iniciando sesión..." : "Iniciar Sesión"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { CognitoUserPool, type CognitoUserSession } from "amazon-cognito-identity-js"

// Configuración de Cognito
const poolData = {
  UserPoolId: "us-east-1_tY3372P8t",
  ClientId: "74j6ahmpqbco9uaaonj5qpfaag",
}

const userPool = new CognitoUserPool(poolData)

type AuthContextType = {
  isAuthenticated: boolean
  isLoading: boolean
  user: any | null
  logout: () => void
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  isLoading: true,
  user: null,
  logout: () => {},
})

export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [user, setUser] = useState<any | null>(null)
  const router = useRouter()

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const currentUser = userPool.getCurrentUser()
        const storedToken = localStorage.getItem("idToken")

        if (!currentUser || !storedToken) {
          console.log("No user or token found")
          setIsAuthenticated(false)
          setUser(null)
          setIsLoading(false)

          // Si no estamos en la página de login, redirigir
          if (window.location.pathname !== "/login") {
            window.location.href = "/login"
          }
          return
        }

        currentUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
          if (err || !session || !session.isValid()) {
            console.log("Session invalid or error:", err)
            setIsAuthenticated(false)
            setUser(null)
            localStorage.removeItem("idToken")

            // Si no estamos en la página de login, redirigir
            if (window.location.pathname !== "/login") {
              window.location.href = "/login"
            }
          } else {
            console.log("Session valid, user authenticated")
            setIsAuthenticated(true)
            setUser(currentUser)
            // Actualizar solo localStorage
            const idToken = session.getIdToken().getJwtToken()
            localStorage.setItem("idToken", idToken)

            // Si estamos en la página de login, redirigir a la página principal
            if (window.location.pathname === "/login") {
              window.location.href = "/"
            }
          }
          setIsLoading(false)
        })
      } catch (error) {
        console.error("Error verificando autenticación:", error)
        setIsAuthenticated(false)
        setUser(null)
        setIsLoading(false)

        // Si no estamos en la página de login, redirigir
        if (window.location.pathname !== "/login") {
          window.location.href = "/login"
        }
      }
    }

    checkAuth()
  }, [])

  const logout = () => {
    const currentUser = userPool.getCurrentUser()
    if (currentUser) {
      currentUser.signOut()
      localStorage.removeItem("idToken")
      window.location.href = "/login"
    }
  }

  return <AuthContext.Provider value={{ isAuthenticated, isLoading, user, logout }}>{children}</AuthContext.Provider>
}

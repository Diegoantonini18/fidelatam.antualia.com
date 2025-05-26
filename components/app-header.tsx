"use client"

import { useState } from "react"
import { LogOut, Menu, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CognitoUserPool } from "amazon-cognito-identity-js"

// Configuración de Cognito
const poolData = {
  UserPoolId: "us-east-1_tY3372P8t",
  ClientId: "74j6ahmpqbco9uaaonj5qpfaag",
}

const userPool = new CognitoUserPool(poolData)

type AppHeaderProps = {
  title?: string
}

export function AppHeader({ title = "Documentos Digitalizados" }: AppHeaderProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleLogout = () => {
    // Obtener el usuario actual
    const currentUser = userPool.getCurrentUser()

    // Si hay un usuario, cerrar sesión
    if (currentUser) {
      currentUser.signOut()
    }

    // Eliminar el token de localStorage
    localStorage.removeItem("idToken")

    // Redirigir a la página de login
    window.location.href = "/login"
  }

  return (
    <>
      <header className="bg-blue-600 text-white p-4 flex items-center justify-between">
        <div className="flex items-center">
          <button
            className="mr-2 p-1 hover:bg-blue-700 rounded-md transition-colors"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <Menu size={24} />
          </button>
          <h1 className="text-xl font-bold">Antualia</h1>
        </div>
        <div className="text-center flex-1">
          <h2 className="text-xl">{title}</h2>
        </div>
        <div>
          <span>Empresa: Fidelatam</span>
        </div>
      </header>

      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-lg transform transition-transform duration-300 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex flex-col h-full">
          <div className="p-4 border-b flex items-center justify-between">
            <h2 className="text-xl font-bold text-blue-600">Menú</h2>
            <button
              className="p-1 hover:bg-gray-100 rounded-md transition-colors"
              onClick={() => setSidebarOpen(false)}
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 p-4">
            <nav className="space-y-2">
              <a
                href="/"
                className="block px-4 py-2 text-gray-700 hover:bg-blue-50 hover:text-blue-600 rounded-md transition-colors"
              >
                Inicio
              </a>

            </nav>
          </div>

          <div className="p-4 border-t">
            <Button variant="destructive" className="w-full flex items-center justify-center" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Cerrar Sesión
            </Button>
          </div>
        </div>
      </div>

      {/* Overlay para cerrar el sidebar al hacer clic fuera */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-40" onClick={() => setSidebarOpen(false)} />
      )}
    </>
  )
}

"use client"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { CalendarIcon } from "lucide-react"
import type { DateRange } from "react-day-picker"
import { useState } from "react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface DateRangePickerProps {
  className?: string
  dateRange: DateRange | undefined
  onDateRangeChange: (range: DateRange | undefined) => void
  onApply: (range: DateRange | undefined) => void
}

// Modificar el componente DateRangePicker para hacerlo más pequeño
export function DateRangePicker({ className, dateRange, onDateRangeChange, onApply }: DateRangePickerProps) {
  const [open, setOpen] = useState(false)
  const [internalDateRange, setInternalDateRange] = useState<DateRange | undefined>(dateRange)

  // Manejar cambios en el rango de fechas internamente
  const handleRangeChange = (range: DateRange | undefined) => {
    setInternalDateRange(range)
    onDateRangeChange(range)
  }

  // Aplicar el rango de fechas y cerrar el popover
  const handleApply = () => {
    onApply(internalDateRange)
    setOpen(false)
  }

  return (
    <div className={cn("grid gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={"outline"}
            className={cn(
              "w-full h-7 justify-start text-left font-normal text-xs",
              !dateRange && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="mr-1 h-3 w-3" />
            {dateRange?.from ? (
              dateRange.to ? (
                <>
                  {format(dateRange.from, "dd/MM/yyyy", { locale: es })} -{" "}
                  {format(dateRange.to, "dd/MM/yyyy", { locale: es })}
                </>
              ) : (
                format(dateRange.from, "dd/MM/yyyy", { locale: es })
              )
            ) : (
              <span>Seleccionar período</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div className="p-2">
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={dateRange?.from}
              selected={internalDateRange}
              onSelect={handleRangeChange}
              numberOfMonths={2}
              locale={es}
              className="text-xs"
            />
            <div className="mt-3 flex justify-end space-x-2">
              <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button size="sm" className="text-xs h-7" onClick={handleApply}>
                Aplicar
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

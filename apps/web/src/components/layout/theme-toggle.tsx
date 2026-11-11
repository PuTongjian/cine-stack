import { Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains('dark')
  )
  function toggle() {
    const next = !dark
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('cine-stack-theme', next ? 'dark' : 'light')
    } catch {
      /* Keep the selected theme when storage is unavailable. */
    }
    setDark(next)
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={dark ? '切换浅色主题' : '切换深色主题'}
      onClick={toggle}
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </Button>
  )
}

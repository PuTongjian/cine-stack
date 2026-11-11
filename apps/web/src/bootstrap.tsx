import { createRoot } from 'react-dom/client'
import { Root } from './app/root'
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/space-grotesk/700.css'
import './styles/globals.css'

createRoot(document.getElementById('root')!).render(<Root />)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './app/App.jsx'
import { installFormValidation } from './shared/lib/formValidation'
import { installNumericInput } from './shared/lib/numericInput'
import './index.css'

installFormValidation()
installNumericInput()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

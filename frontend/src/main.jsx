import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import MerchantPage from './MerchantPage.jsx'
import BazaarDemoPage from './BazaarDemoPage.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/merchant" element={<MerchantPage />} />
        <Route path="/merchant/:merchantId" element={<MerchantPage />} />
        <Route path="/debug/bazaar" element={<BazaarDemoPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
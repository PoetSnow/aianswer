import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AnswerPage from './pages/AnswerPage'
import BankPage from './pages/BankPage'
import './App.css'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<BankPage />} />
        <Route path="/answer" element={<AnswerPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

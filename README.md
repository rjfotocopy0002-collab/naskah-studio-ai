# Naskah Studio — AI Document Assistant

Aplikasi web full-stack berbasis **React, TypeScript, Tailwind CSS, dan Express** yang berfungsi sebagai **AI Document Assistant** dengan tata letak split-screen: kolom chat interaktif (40%) dan editor/pratinjau kertas A4 real-time (60%).

## Fitur Utama

- **Chat Interaktif Berkonteks Dokumen (`/api/chat`)**: Menggunakan Google Gemini API (`@google/genai` dengan model `gemini-4-hydrogen`) dan respons JSON terstruktur (`reply` & `documentContent`).
- **Pembuatan Gambar via Groq API**: Perintah chat untuk membuat gambar/ilustrasi/diagram diproses oleh Groq (`openai/gpt-oss-120b`), ditampilkan di chat dengan tombol unduh PNG, disisipkan otomatis ke dokumen A4, serta ikut terbawa saat ekspor Word & PDF.
- **Unggah File Referensi (`.txt`, `.md`, `.docx`)**: Lampirkan dokumen referensi untuk dirangkum, diolah ulang, atau dijadikan acuan penulisan.
- **Kertas A4 Live Preview & Editor**: Tampilan dokumen bergaya kertas A4 dengan dukungan Markdown/GFM (tabel, daftar, heading, kutipan, gambar) serta mode **Edit Langsung** yang tersinkronisasi ke sesi chat berikutnya.
- **Ekspor Dokumen**:
  - **Export ke Word (`.docx`)** menggunakan `docx` dan `file-saver`.
  - **Export ke PDF (`.pdf`)** menggunakan `jspdf` dengan margin, tabel bergaris, dukungan teks Arab RTL, gambar, dan penomoran halaman A4.
  - **Salin Teks** ke clipboard dalam satu klik.

## Panduan Instalasi & Konfigurasi API

### 1. Instalasi Package

```bash
npm install @google/genai docx file-saver jspdf mammoth react-markdown remark-gfm lucide-react
npm install -D @types/file-saver
```

### 2. Konfigurasi API Key (`.env.local`)

1. Dapatkan Gemini API Key dari [Google AI Studio](https://aistudio.google.com/apikey) dan Groq API Key dari [Groq Console](https://console.groq.com/keys).
2. Buat file `.env.local` pada root direktori proyek:

```env
GEMINI_API_KEY="masukkan_api_key_gemini_anda_di_sini"
GROQ_API_KEY="masukkan_api_key_groq_anda_di_sini"
```

> Catatan: Server Express membaca `process.env.GEMINI_API_KEY` dan `process.env.GROQ_API_KEY` dari environment atau `.env.local` secara otomatis di sisi backend sehingga kunci API tetap aman dan tidak pernah dikirim ke browser.

### 3. Menjalankan Aplikasi

```bash
# Mode pengembangan (port 3000)
npm run dev

# Build produksi
npm run build
npm start
```

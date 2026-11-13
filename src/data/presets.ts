import { DocumentPreset } from '../types/document';

export const DOCUMENT_PRESETS: DocumentPreset[] = [
  {
    id: 'proposal',
    label: 'Proposal Proyek',
    title: 'Proposal Pengembangan Sistem Informasi Akademik',
    content: `# Proposal Pengembangan Sistem Informasi Akademik Terpadu

**Disusun oleh:** Tim Teknologi Informasi  
**Tanggal:** 12 November 2026  
**Status:** Draf Awal

---

## 1. Ringkasan Eksekutif

Transformasi digital di lingkungan pendidikan tinggi menuntut integrasi data akademik yang cepat, akurat, dan mudah diakses oleh mahasiswa, dosen, serta staf administrasi. Dokumen ini memaparkan rancangan pengembangan **Sistem Informasi Akademik Terpadu (SIAKAD)** berbasis web untuk meningkatkan efisiensi operasional dan kualitas layanan kampus.

## 2. Latar Belakang & Permasalahan

Saat ini, proses pengelolaan nilai, pengisian Kartu Rencana Studi (KRS), dan rekapitulasi absensi masih tersebar pada beberapa sistem terpisah. Hal ini menimbulkan beberapa kendala utama:

- Duplikasi input data antar unit administrasi.
- Keterlambatan pembaruan transkrip nilai mahasiswa.
- Kesulitan pemantauan performa akademik secara real-time oleh pimpinan program studi.

## 3. Ruang Lingkup Pekerjaan

Pengembangan sistem mencakup empat modul inti berikut:

1. **Portal Mahasiswa & Dosen** — Pengisian KRS daring, jadwal kuliah, serta akses materi perkuliahan.
2. **Manajemen Penilaian & Transkrip** — Input nilai tervalidasi dan penerbitan transkrip otomatis.
3. **Pelaporan Akademik** — Dasbor analitik kelulusan, IPK rata-rata, dan beban mengajar dosen.
4. **Integrasi Pembayaran** — Sinkronisasi status tagihan UKT secara otomatis dengan sistem keuangan.

## 4. Estimasi Jadwal Pelaksanaan

| Fase | Aktivitas Utama | Durasi |
| :--- | :--- | :--- |
| Fase 1 | Analisis kebutuhan dan perancangan basis data | 3 Minggu |
| Fase 2 | Pengembangan modul inti dan antarmuka pengguna | 6 Minggu |
| Fase 3 | Pengujian UAT, migrasi data, dan pelatihan staf | 3 Minggu |

## 5. Penutup

Dengan implementasi sistem terpadu ini, institusi diharapkan mampu memangkas waktu pemrosesan administrasi akademik hingga 60% serta menghadirkan pengalaman layanan digital yang modern dan andal.`,
  },
  {
    id: 'cover-letter',
    label: 'Surat Lamaran',
    title: 'Surat Lamaran Kerja — Product Manager',
    content: `# Surat Lamaran Kerja

**Jakarta, 12 November 2026**

**Kepada Yth.**  
**Bapak/Ibu Tim Rekrutmen**  
PT Teknologi Nusantara Digital  
Jl. Jenderal Sudirman Kav. 52–53  
Jakarta Selatan

Dengan hormat,

Melalui surat ini, saya bermaksud mengajukan lamaran untuk posisi **Product Manager** di PT Teknologi Nusantara Digital. Saya memiliki pengalaman lebih dari 4 tahun dalam mengelola siklus hidup produk digital berbasis B2B SaaS, mulai dari riset pengguna, penyusunan roadmap, hingga kolaborasi lintas fungsi bersama tim engineering dan desain.

Pada posisi terakhir saya sebagai Associate Product Manager, saya berhasil memimpin peluncuran fitur otomasi alur kerja yang meningkatkan retensi pengguna aktif bulanan sebesar 28% dalam dua kuartal. Saya terbiasa mengambil keputusan berbasis data analitik sekaligus menjaga komunikasi yang terstruktur dengan pemangku kepentingan.

Sebagai bahan pertimbangan, bersama surat ini saya sertakan daftar riwayat hidup (CV) serta portofolio produk yang pernah saya tangani. Besar harapan saya untuk dapat berdiskusi lebih lanjut melalui sesi wawancara mengenai bagaimana kontribusi saya dapat mendukung pertumbuhan produk di perusahaan Bapak/Ibu.

Atas perhatian dan kesempatan yang diberikan, saya ucapkan terima kasih.

Hormat saya,

**Raka Pratama**  
raka.pratama@email.com · +62 812-3456-7890`,
  },
  {
    id: 'meeting-notes',
    label: 'Notulensi Rapat',
    title: 'Notulensi Rapat Evaluasi Kuartal IV',
    content: `# Notulensi Rapat Evaluasi Kuartal IV

**Hari / Tanggal:** Kamis, 12 November 2026  
**Waktu:** 09.30 – 11.00 WIB  
**Lokasi:** Ruang Rapat Utama / Daring  
**Pimpinan Rapat:** Nadia Kusuma (Head of Operations)

---

## Agenda Pembahasan

1. Evaluasi pencapaian target operasional Q4.
2. Identifikasi hambatan distribusi logistik regional.
3. Penetapan prioritas kerja untuk kuartal mendatang.

## Ringkasan Diskusi

- **Kinerja Operasional:** Tingkat penyelesaian pesanan tepat waktu mencapai **94,2%**, meningkat 3,1% dibanding kuartal sebelumnya.
- **Kendala Gudang Regional:** Terjadi penumpukan stok pada cabang Surabaya akibat keterlambatan sinkronisasi inventaris harian.
- **Kebutuhan Otomasi:** Tim operasional mengusulkan pembaruan sistem pelacakan stok secara real-time sebelum akhir bulan.

## Tindak Lanjut (Action Items)

| Tugas | Penanggung Jawab | Tenggat Waktu |
| :--- | :--- | :--- |
| Audit selisih inventaris gudang Surabaya | Dimas Wijaya | 18 November 2026 |
| Implementasi sinkronisasi stok otomatis | Tim Engineering | 25 November 2026 |
| Penyusunan anggaran operasional Q1 2027 | Nadia Kusuma | 30 November 2026 |`,
  },
  {
    id: 'blank',
    label: 'Dokumen Kosong',
    title: 'Dokumen Baru',
    content: '',
  },
];

export const CHAT_STARTER_PROMPTS = [
  'Analisis bentuk, struktur, dan periksa tulisan yang benar pada dokumen ini',
  'Buatkan gambar diagram alur sistem untuk dimasukkan ke dokumen ini',
  'Buatkan surat lamaran kerja formal untuk posisi UI/UX Designer',
  'Ringkas dokumen ini menjadi 3 poin eksekutif yang padat',
];

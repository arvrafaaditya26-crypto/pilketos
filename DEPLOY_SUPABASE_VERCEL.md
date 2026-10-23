# Deploy Pemilihan MPK ke Vercel + Supabase

## 1. Siapkan database Supabase

1. Buat project baru di Supabase.
2. Buka **SQL Editor**.
3. Jalankan seluruh isi `supabase_schema.sql`.
4. Ambil nilai **Project URL** dan **service_role key** dari Project Settings → API.

`service_role key` hanya disimpan sebagai environment variable server. Jangan masukkan ke JavaScript browser dan jangan commit file `.env`.

## 2. Environment variable di Vercel

Tambahkan pada Project Settings → Environment Variables:

- `ADMIN_PASSWORD` — password panel admin.
- `SUPABASE_URL` — URL project Supabase.
- `SUPABASE_SERVICE_ROLE_KEY` — service role key Supabase.

Jika dua variable Supabase tersedia, aplikasi otomatis memakai adapter PostgreSQL Supabase. Jika tidak tersedia, mode lokal memakai SQLite.

## 3. Deploy

Import repository/folder project ke Vercel. File `vercel.json` sudah disediakan dan `server.js` sudah mengekspor Express app untuk runtime Vercel.

## Catatan file upload

Foto kandidat dan wallpaper hero saat ini masih disimpan ke folder `uploads/`. Database sudah siap dipindahkan ke Supabase, tetapi penyimpanan file di filesystem Vercel bersifat sementara. Untuk produksi, foto sebaiknya dipindahkan ke Supabase Storage agar tidak hilang saat deployment atau instance berganti.

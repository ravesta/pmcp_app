# PMCP

Project Monitoring & Capacity Planning System untuk tim BA dan QA.

Repository ini adalah kode aplikasi (CD-46: terpisah dari repository governance `D:\warrior-team`).
Dokumen requirement, desain, dan keputusan ada di repository governance, folder `projects/PMCP/`:
`ba/brd.md`, `ba/fsd.md`, `dev/technology-baseline.md`, `dev/technical-design.md`,
`dev/database-design.md`, `dev/security-design.md`.

## Teknologi

Modular monolith: Next.js (App Router) + TypeScript strict + PostgreSQL, dijalankan sebagai satu proses
Node di server lokal. Rincian dan alasan: Technology Baseline v1.0.

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm install` | memasang dependensi |
| `npm run dev` | menjalankan mode pengembangan |
| `npm run typecheck` | pemeriksaan tipe TypeScript |
| `npm test` | seluruh uji (unit, arsitektur, konvensi kode, migrasi database) |
| `npm run test:unit` / `npm run test:integration` | sebagian uji |
| `npm run build` | build produksi (artefak `standalone`) |
| `npm run test:e2e` | uji E2E di browser nyata: membuat database sementara, build, `next start`, lalu skenario `tests/e2e/*.e2e.mjs` (±2 menit) |

Uji E2E memerlukan PostgreSQL sungguhan (`DATABASE_URL` menunjuk servernya; database `pmcp_e2e_*` dibuat dan dihapus
otomatis) dan Chromium. Bila Chromium bawaan Playwright tidak terpasang, isi `E2E_CHROMIUM_PATH`. Opsi: `--skip-build`,
`--keep` (jangan hapus database), dan nama berkas sebagai penyaring (mis. `npm run test:e2e -- 03-`). Tangkapan layar
kegagalan masuk ke `test-results/e2e`.

Uji integrasi skema memakai PGlite (PostgreSQL dalam WASM) agar berjalan tanpa Docker. Pipeline CI/CD
wajib menjalankan uji yang sama pada PostgreSQL sungguhan.

## Struktur

```text
prisma/migrations/   SQL migrasi terversi (sumber kebenaran skema, TD-16)
src/app/             halaman dan route (lapisan UI/transport)
src/modules/<m>/     modul: domain, application, infrastructure, index.ts
src/shared/          kalender, tanggal, pembulatan, jam (Clock), hasil/galat (bebas kerangka kerja)
src/platform/        konfigurasi, jam, (kelak) klien database, logging, container
tests/               unit, integrasi
```

## Aturan kode (wajib, ditegakkan uji otomatis)

1. **Setiap fungsi diberi komentar** dengan butir Tujuan, Masukan/Keluaran, `Efek samping:`, dan `Rujukan:`
   (ID FR/BL/EC). Uji `code-conventions` gagal bila ada fungsi tingkat atas tanpa komentar lengkap (CD-160).
2. **Dependensi satu arah**: domain murni, application tidak mengimpor infrastructure, UI hanya lewat
   `index.ts` modul. Uji `architecture` menegakkannya (TD-06).
3. **"Hari ini" hanya dari `Clock`**: tidak ada `Date.now()` atau `new Date()` tanpa argumen di luar
   `src/shared/clock.ts` (TD-05).
4. Aturan bisnis hanya di `domain`; tanggal bisnis bertipe `IsoDate` (string `YYYY-MM-DD`), bukan `Date`.
5. Rahasia tidak pernah di repository; konfigurasi lewat variabel lingkungan (`.env.example`).

## Lingkungan

`APP_ENV` = `development` | `test` | `staging` | `production`. Server build Next.js selalu `NODE_ENV=production`,
jadi staging wajib mengisi `APP_ENV=staging`. `CLOCK_OVERRIDE` hanya boleh di non-produksi.

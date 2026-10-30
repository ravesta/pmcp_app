-- Migrasi 7: mencatat tanggal UAT Sign Off dan Go Live pada project.
-- Alasan: pemilik meminta Detail Project mencatat waktu UAT Sign Off dan Go Live. Kedua kolom opsional (boleh kosong)
-- dan hanya menyimpan tanggal; tidak ada aturan urutan terhadap tahapan atau status project.
-- Rujukan: permintaan pemilik 2026-10-29 (perlu dicatat sebagai Change Request / keputusan pada register PMCP).

ALTER TABLE project
  ADD COLUMN uat_sign_off_date date,
  ADD COLUMN go_live_date      date;

# Oriental Accounting — Core Ledger, AR/AP, Bank & Kas, Laporan & Tutup Buku, Pajak, Analitik & Anggaran, Aset

Modul akuntansi Oriental, dibangun bertahap per mini app:

- **Mini App 1 — Core Ledger:** Bagan Akun, Jurnal, Entri Jurnal (double-entry), Buku Besar, Neraca Saldo.
- **Mini App 2 — Faktur & Tagihan (AR/AP):** Kontak, Faktur Penjualan, Tagihan Vendor, Nota Kredit, Pembayaran, Umur Piutang & Utang, cetak faktur.
- **Mini App 4 — Laporan & Tutup Buku:** Laba Rugi (dengan pembanding & margin kotor per pilar), Neraca, telusur angka ke buku besar, cetak & ekspor Excel, penyesuaian HPP dari stok opname, checklist & penutupan bulan, buka kembali dengan alasan, jurnal penutup tahun.
- **Mini App 5 — Pajak (PPN):** identitas pajak kontak (NPWP/NIK, ID TKU), Faktur Pajak Keluaran per kode transaksi + ekspor Excel template Coretax, penjualan eceran digunggung (pisah DPP/PPN otomatis), PPN Masukan + masa pengkreditan, pencocokan dengan daftar PPN Masukan Coretax, rekap SPT Masa PPN, jurnal kompensasi & setoran dengan NTPN.
- **Mini App 6 — Analitik & Anggaran:** dimensi Pilar + Outlet/Lokasi, distribusi analitik per baris (otomatis dari akun pilar, model distribusi, dan outlet kas), aturan kelengkapan, edit analitik massal, Laba Rugi per pilar/outlet sampai laba bersih (biaya bersama "tidak teralokasi" atau dialokasikan menurut pendapatan), anggaran per akun per bulan, anggaran vs realisasi.
- **Mini App 7 — Aset & Penyusutan:** register aset per unit (dari tagihan atau saldo awal aset lama), penyusutan komersial garis lurus + run bulanan berpilar/outlet, perbaikan dikapitalisasi, pelepasan (laba/rugi), penyusutan fiskal PMK 72/2023 & koreksi fiskal, biaya dibayar di muka & pendapatan diterima di muka, laporan register vs buku besar.
- **Mini App 3 — Bank & Kas:** Rekening, impor mutasi BCA (CSV), rekonsiliasi dengan saran otomatis, pencairan QRIS/EDC + MDR, transfer/setoran via dana dalam perjalanan, kas harian dengan hitung fisik, laporan rekonsiliasi.

Setiap dokumen yang diposting otomatis menghasilkan entri jurnal ke Core Ledger.

## Menjalankan

Butuh Node.js 18 atau lebih baru.

```bash
npm install
npm run dev        # buka http://localhost:5173
npm test           # 69 tes otomatis untuk ketujuh mini app
npm run build      # typecheck + build produksi ke dist/
```

Saat pertama dibuka, aplikasi memuat **data contoh**: 7 kontak, faktur & tagihan September–November (ada yang lunas, sebagian, dan lewat jatuh tempo), pembayaran, setoran modal, bayar listrik, serta draft faktur yang melewati batas kredit. Juga ada mutasi BCA 1–4 Nov yang belum dicocokkan — buka **Rekonsiliasi** untuk mencobanya, lalu impor `public/contoh-mutasi-bca.csv` di **Mutasi Bank** untuk melihat deteksi duplikat. Data lama di browser dimigrasi otomatis. Data tersimpan di browser. Untuk mengulang, buka **Pengaturan → Muat ulang data contoh**.

## Fitur

| Layar | Fungsi |
|---|---|
| Dashboard | Saldo kas & bank, status keseimbangan buku besar, ringkasan per jurnal, draft yang menunggu |
| Entri Jurnal | Daftar + filter; form multi-baris dengan indikator timbangan debit–kredit; posting; pembalikan |
| Buku Besar | Mutasi per akun dengan saldo awal, saldo berjalan, saldo akhir |
| Neraca Saldo | Saldo awal, mutasi, saldo akhir (debit & kredit) dan cek keseimbangan |
| Bagan Akun | 54 akun COA distribusi & ritel F&B; tambah, ubah, nonaktifkan |
| Jurnal | PJ, PB, BNK, KAS, UMUM beserta nomor berikutnya |
| Pengaturan | Profil perusahaan (kop faktur), tanggal kunci periode, reset data prototipe |
| Faktur Penjualan | Faktur multi-baris, PPN per baris, status pembayaran, cetak/PDF, nota kredit |
| Tagihan Vendor | Tagihan supplier, PPN Masukan, nota kredit pembelian |
| Pembayaran | Terima/bayar, alokasi ke beberapa dokumen, kelebihan bayar jadi deposit/uang muka, pembatalan |
| Umur Piutang & Utang | Aging per kontak: belum jatuh tempo, 1–30, 31–60, 61–90, >90 hari |
| Kontak | Pelanggan & supplier, tier member, termin, batas kredit, akun piutang/utang |
| Rekening | Rekening bank & kas, saldo buku vs bank, rekening baru, transfer/setoran |
| Mutasi Bank | Impor CSV BCA/umum dengan cek duplikat & saldo, input manual, riwayat impor |
| Rekonsiliasi | Saran pasangan bertingkat + pencocokan manual (faktur, akun, catatan buku), batal rekonsiliasi |
| Laporan rekonsiliasi | Saldo buku ± item belum cocok = saldo bank |
| Kas Harian | Hitung pecahan uang, selisih kas lebih/kurang dijurnal otomatis |
| Laba Rugi | Per periode, pembanding periode sebelumnya/tahun lalu, laba kotor per pilar, klik angka → buku besar |
| Neraca | Per tanggal + pembanding, cek Aset = Kewajiban + Ekuitas |
| Tutup Buku | Checklist wajib/peringatan, tutup bulan (tanggal kunci maju + ringkasan angka), buka kembali, jurnal penutup tahun |
| Penyesuaian HPP | Nilai stok opname per akun persediaan → HPP, dibagi ke pilar (usulan proporsional, bisa dikoreksi) |
| Ringkasan PPN | Rekap masa (PK faktur + digunggung − PM − lebih bayar lalu), cek ke buku, batas lapor, kompensasi, setor + NTPN |
| Faktur Pajak Keluaran | Per kode transaksi, validasi identitas, ekspor Excel Coretax, catat nomor yang terbit, tanda perlu retur |
| Penjualan Eceran | Rekap harian tunai/QRIS/bebas PPN → DPP & PPN otomatis; ekspor rekap digunggung |
| PPN Masukan | No. & tanggal Faktur Pajak supplier, masa kredit (maks. +3 masa), cocokkan dengan CSV Coretax |
| Laba Rugi per Pilar/Outlet | Kolom per akun analitik teratas + "Tidak teralokasi"; mode alokasi menurut pendapatan; klik angka → baris jurnal |
| Anggaran vs Realisasi | Per bulan/kuartal/tahun, selisih & capaian, tanda merah, daftar realisasi tanpa anggaran |
| Anggaran | Grid 12 bulan per akun (opsional per pilar), salin dari realisasi tahun lalu ±% |
| Edit Analitik | Filter baris belum terdistribusi, pasang distribusi ke banyak baris sekaligus |
| Dimensi & Model | Akun analitik bertingkat, aturan kelengkapan, distribusi bawaan per rekening kas/bank, model distribusi |
| Register Aset | Daftar aset & nilai buku, kandidat dari tagihan/faktur (aset, 1403, 2303) |
| Kartu aset | Data aset, kelompok fiskal, pemakai (pilar/outlet), jadwal komersial & fiskal, perbaikan, pelepasan |
| Penyusutan Bulanan | Satu jurnal per bulan untuk semua aset & penangguhan, berurutan, bisa dibatalkan (run terakhir) |
| Biaya & Pendapatan Ditangguhkan | Sewa/asuransi dibayar di muka, pendapatan diterima di muka; jadwal & sisa |
| Laporan Aset | Register vs buku besar per kategori; komersial vs fiskal per tahun + ekspor Excel |

## Aturan bisnis yang dijaga

1. Entri hanya bisa diposting bila total debit = total kredit, minimal 2 baris, tiap baris berisi debit **atau** kredit.
2. Entri yang sudah diposting tidak bisa diedit atau dihapus — koreksi lewat **pembalikan** (entri baru, debit/kredit ditukar, saling tertaut).
3. Nomor `KODE/YYYY/MM/0001` diberikan saat posting, per jurnal per bulan, sehingga tidak bolong.
4. Entri bertanggal ≤ tanggal kunci tidak bisa diposting atau dibalik.
5. Nominal disimpan sebagai **bilangan bulat Rupiah** — tidak ada float.
6. Saldo normal mengikuti tipe akun; akun kontra (akumulasi penyusutan, retur penjualan, prive) dibalik.
7. PPN dihitung per dokumen per jenis pajak: DPP = dasar × 11/12, PPN = 12% × DPP (tarif efektif 11%, PMK 131/2024). Barang dibebaskan PPN memakai pajak "Dibebaskan PPN".
8. Entri jurnal dari faktur/tagihan hanya bisa dikoreksi lewat nota kredit; entri dari pembayaran lewat pembatalan pembayaran.
9. Nota kredit tidak boleh melebihi sisa tagihan dokumen asal; alokasi pembayaran tidak boleh melebihi sisa tagihan.
10. Batas kredit pelanggan memberi peringatan (tidak memblokir).
11. HPP dicatat lewat jurnal penyesuaian akhir bulan dari stok opname (Debit HPP, Kredit Persediaan) sampai modul persediaan tersedia.
12. Rekonsiliasi tidak mengubah entri yang sudah diposting; status cocok disimpan di mutasi. Satu baris buku hanya bisa dipasangkan dengan satu mutasi.
13. Pencairan QRIS/EDC: Debit bank (bersih) + Debit 6205 (MDR), Kredit 1112 (kotor). Saran hanya muncul bila potongan ≤ toleransi di Pengaturan.
14. Transfer ke rekening bank lewat 1103 Dana dalam Perjalanan, diselesaikan saat mutasinya dicocokkan. Transfer ke kas langsung.
15. Kas harian hanya bisa ditutup sekali per rekening per tanggal; selisih ke 7102 (lebih) / 7202 (kurang).
16. HPP periodik: saldo buku persediaan − nilai opname = HPP (Debit 5101–5104, Kredit 1301–1303); pemakaian kemasan 1304 → 6204. Total pembagian ke pilar wajib sama dengan HPP barang. Satu penyesuaian per bulan.
17. Pembagian HPP yang murni proporsional membuat margin antar pilar sama; laporan memberi label estimasi sampai pembagiannya dikoreksi.
18. Tutup bulan diblokir bila masih ada draft atau neraca saldo tidak seimbang (dan, untuk Desember, bila jurnal penutup belum dibuat). Peringatan boleh dilewati dengan alasan ≥ 10 karakter.
19. Hanya periode terakhir yang ditutup yang bisa dibuka kembali, wajib alasan; perubahan angka setelah ditutup terdeteksi dari ringkasan.
21. Satu faktur penjualan dipecah menjadi Faktur Pajak per kode transaksi (default 04 = DPP nilai lain 11/12, 08 = dibebaskan). Ekspor ditolak bila NPWP/NIK, ID TKU, atau alamat pembeli belum lengkap, atau kode 07/08 tanpa keterangan tambahan.
22. Faktur Pajak yang sudah terbit lalu terkena nota kredit ditandai "perlu retur/pembetulan".
23. Penjualan eceran (khusus PKP Pedagang Eceran): PPN = bruto kena PPN × 132/1332 untuk tarif 12% DPP 11/12 (efektif 11%). Satu rekap per kas per tanggal.
24. PPN Masukan dikreditkan di masa Faktur Pajak, boleh digeser paling lama 3 masa berikutnya (PMK 81/2024 Pasal 376).
25. Kompensasi akhir masa ditolak bila PPN Keluaran di buku ≠ rekap. Kurang bayar → 2204 Utang PPN; lebih bayar → 1404, otomatis dikompensasikan di masa berikutnya. Batas lapor & setor: akhir bulan berikutnya.
26. Distribusi analitik tidak mengubah debit/kredit/saldo; boleh diedit setelah posting, kecuali di periode yang sudah ditutup. Per dimensi total 100% (maks. 2 desimal); sisa pembulatan rupiah masuk porsi terbesar.
27. Saat posting (modul mana pun), dimensi yang kosong diisi otomatis: akun pilar → pilarnya, lalu model distribusi (yang khusus kontak didahulukan), lalu distribusi bawaan rekening kas/bank. Akun neraca tidak pernah membawa analitik.
28. Aturan kelengkapan per dimensi & kelompok akun: wajib (blokir posting), disarankan (peringatan di checklist tutup buku), opsional, tidak tersedia. Tahap awal Pilar untuk beban = disarankan.
29. Laba Rugi per dimensi selalu berjumlah sama dengan Laba Rugi biasa, di kedua mode biaya bersama.
30. Penyusutan komersial: garis lurus per bulan mulai bulan aset dipakai; default masa manfaat = kelompok fiskal; pembulatan rupiah, bulan terakhir menghabiskan sisa. Tidak ada penyusutan di bulan pelepasan.
31. Setelah penyusutan pertama dibukukan, nilai/tanggal/masa manfaat aset terkunci; perubahan lewat perbaikan dikapitalisasi (nilai buku + tambahan bulan) atau pelepasan.
32. Run bulanan berurutan, satu kali per bulan; hanya run terakhir yang bisa dibatalkan. Pelepasan mewajibkan penyusutan sampai bulan sebelumnya sudah dibukukan.
33. Fiskal (PMK 72/2023): mulai bulan perolehan, tahun pertama prorata; garis lurus atau saldo menurun (bangunan hanya garis lurus); saldo menurun menghabiskan sisa di tahun terakhir. Tidak dijurnal; koreksi = komersial − fiskal.
34. Penangguhan dibagi rata per bulan (sisa pembulatan di bulan terakhir); saldo awal yang sudah diakui dilewati di bulan-bulan pertama.
20. Jurnal penutup 31 Desember menolkan akun pendapatan & beban ke 3201 Laba Ditahan. Jurnal ini tidak dihitung di Laba Rugi, sehingga laporan tahunan tetap utuh.

Lihat **ARCHITECTURE.md** untuk struktur kode dan panduan menyambungkan ke backend.

> **Ekspor Coretax belum diverifikasi.** Pemetaan kolom di `src/lib/coretaxTemplate.ts` disusun dari struktur umum template Faktur Keluaran Coretax. Sebelum dipakai untuk faktur sungguhan, cocokkan dengan paket ConverterEfakturCoretax terbaru dari pajak.go.id (v1.6, 23/01/2026), uji 1 faktur sampai berhasil diimpor, lalu centang "Template sudah diverifikasi" di Pengaturan → Pajak. Kode satuan ukur, Cap Fasilitas, dan keterangan tambahan kode 08 wajib dikonfirmasi konsultan. NPWP di data contoh fiktif.
>
> Kelompok fiskal per aset wajib dicek terhadap Lampiran PMK 72/2023 oleh konsultan (default kategori hanya titik awal). Aset contoh (truk, chiller), sewa ruko, dan paket kelas Oriental Learn adalah ilustrasi. Penjualan aset oleh PKP dapat terutang PPN — Faktur Pajaknya dibuat terpisah sesuai arahan konsultan.
>
> Daftar outlet/lokasi (Toko Retail Watampone, Gudang Kering/Frozen, Armada, Kantor Pusat), model distribusi, dan anggaran 2026 di data contoh adalah ilustrasi — sesuaikan di Dimensi & Model dan Anggaran.
>
> Template CSV BCA dibuat berdasarkan format ekspor mutasi KlikBCA yang umum dan **perlu diverifikasi dengan file ekspor asli** Oriental (KlikBCA Bisnis/myBCA bisa sedikit berbeda). Kata kunci aturan QRIS/EDC juga perlu disesuaikan dengan keterangan mutasi yang sebenarnya.
>
> COA di `src/data/seed/coa.ts` adalah draf v0.1. Klasifikasi PPN per barang (kena PPN atau dibebaskan) wajib dikonfirmasi konsultan pajak. Faktur yang dicetak adalah faktur komersial, bukan Faktur Pajak (e-Faktur masuk Mini App 4).

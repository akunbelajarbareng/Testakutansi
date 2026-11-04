/**
 * Skema validasi form (Zod). Ini validasi STRUKTUR input.
 * Aturan akuntansi (keseimbangan, tanggal kunci, dll.) tetap di rules.ts
 * dan dicek ulang saat posting — juga wajib dicek ulang di backend nanti.
 */
import { z } from 'zod';

const money = z.number().int('Nominal harus bilangan bulat').nonnegative('Nominal tidak boleh negatif');

export const entryLineSchema = z
  .object({
    id: z.string(),
    accountId: z.string(),
    label: z.string().max(200, 'Keterangan maksimal 200 karakter'),
    debit: money,
    credit: money,
    analytic: z.record(z.number()).optional(),
  })
  .refine((l) => !(l.debit > 0 && l.credit > 0), {
    message: 'Isi debit atau kredit saja',
    path: ['credit'],
  });

export const entryFormSchema = z.object({
  journalId: z.string().min(1, 'Pilih jurnal'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal tidak valid'),
  reference: z.string().max(120, 'Referensi maksimal 120 karakter'),
  lines: z.array(entryLineSchema),
});

export type EntryFormValues = z.infer<typeof entryFormSchema>;

export const accountFormSchema = z.object({
  code: z.string().regex(/^\d{4}$/, 'Kode harus 4 digit angka'),
  name: z.string().trim().min(3, 'Nama minimal 3 karakter').max(80),
  type: z.enum(['asset', 'liability', 'equity', 'income', 'expense']),
  group: z.enum([
    'Aset Lancar',
    'Aset Tetap',
    'Kewajiban',
    'Ekuitas',
    'Pendapatan',
    'Harga Pokok Penjualan',
    'Beban Operasional',
    'Pendapatan & Beban Lain',
    'Pajak Penghasilan',
  ]),
  contra: z.boolean(),
  liquidity: z.boolean(),
});

export type AccountFormValues = z.infer<typeof accountFormSchema>;

// ── Mini App 2 ──

export const invoiceLineSchema = z.object({
  id: z.string(),
  description: z.string().trim().min(1, 'Isi deskripsi').max(200),
  accountId: z.string().min(1, 'Pilih akun'),
  quantity: z
    .number({ invalid_type_error: 'Isi kuantitas' })
    .positive('Harus lebih dari 0')
    .refine((v) => Math.round(v * 1000) === v * 1000, 'Maks. 3 desimal'),
  unitPrice: money,
  taxId: z.string().min(1, 'Pilih pajak'),
  analytic: z.record(z.number()).optional(),
});

export const invoiceFormSchema = z
  .object({
    partnerId: z.string().min(1, 'Pilih kontak'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal tidak valid'),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal tidak valid'),
    reference: z.string().max(120),
    notes: z.string().max(500),
    lines: z.array(invoiceLineSchema).min(1, 'Minimal 1 baris'),
  })
  .refine((v) => v.dueDate >= v.date, { message: 'Jatuh tempo tidak boleh sebelum tanggal dokumen', path: ['dueDate'] });

export type InvoiceFormValues = z.infer<typeof invoiceFormSchema>;

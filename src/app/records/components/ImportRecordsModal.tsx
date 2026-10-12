'use client';

import { useState, useRef, DragEvent, ChangeEvent } from 'react';
import {
  X,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  Loader2,
  Download,
  AlertTriangle,
  FileCheck,
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { MODULES } from '@/lib/records/registry';
import { ALIASES } from '@/lib/records/import-rows';
import { getField, type ImportRow } from '@/lib/import/sheet';
import { IMPORT_FILE_TYPES, readImportFile, sendInBatches } from '@/lib/import/client';
import type { ModuleId } from '@/lib/records/types';

// Pre-Payment Sample Template Headers & Rows
const SAMPLE_PRE_PAYMENT_HEADERS = [
  'Payment ID',
  'Deals ID',
  'Task Person',
  'Payment Mode',
  'Payment Type',
  'Material Vendor Name',
  'Service Vendor Name',
  'Work Type',
  'Amount',
  'Date',
  'Payment Status',
  'UTR Transaction Date',
  'UTR / Transaction No',
  'Remarks',
  'Approved By',
];

const SAMPLE_PRE_PAYMENT_ROWS = [
  [
    'PPR1',
    'DL1',
    'Employee A 015',
    'DBS - MINION',
    'Material Payment',
    'MV1',
    '',
    'Gypsum False Ceiling',
    '25000',
    '2026-03-27',
    'Paid',
    '2026-03-27',
    'UTR987654321',
    'Advance payment for gypsum boards',
    'Admin',
  ],
  [
    'PPR2',
    'DL2',
    'Employee B 001',
    'UPI',
    'Service Payment',
    '',
    'SV1',
    'Painting',
    '15000',
    '2026-04-02',
    'Approved',
    '2026-04-02',
    'UPI123456789',
    'Labour advance for painting',
    'Admin',
  ],
  [
    'PPR3',
    'DL1',
    'Employee A 015',
    'NEFT / RTGS / IMPS',
    'Advance',
    'MV2',
    '',
    'Modular Furniture',
    '50000',
    '2026-04-05',
    'Pending Approval',
    '',
    '',
    'Initial procurement advance',
    '',
  ],
];

// Payment Collection Sample Template Headers & Rows
const SAMPLE_PAYMENT_COLLECTION_HEADERS = [
  'Collection ID',
  'Deals ID',
  'Task Person',
  'Collection Mode',
  'Collection Type',
  'Material Vendor Name',
  'Service Vendor Name',
  'Amount',
  'Date',
  'Collection Status',
  'UTR Transaction Date',
  'UTR / Transaction No',
  'Remarks',
  'Approved By',
];

const SAMPLE_PAYMENT_COLLECTION_ROWS = [
  [
    'PCR1',
    'DL1',
    'Employee A 015',
    'DBS - MINION',
    'Advance',
    '',
    '',
    '50000',
    '2026-03-25',
    'Collected',
    '2026-03-25',
    'UTR112233445',
    'Initial advance payment received from client',
    'Admin',
  ],
  [
    'PCR2',
    'DL2',
    'Employee B 001',
    'NEFT / RTGS / IMPS',
    'Part Payment',
    '',
    '',
    '75000',
    '2026-04-05',
    'Approved',
    '2026-04-05',
    'NEFT99887766',
    'First milestone collection',
    'Admin',
  ],
  [
    'PCR3',
    'DL1',
    'Employee A 015',
    'Cheque',
    'Final Payment',
    '',
    '',
    '45000',
    '2026-04-10',
    'Pending Approval',
    '',
    '',
    'Cheque received pending clearance',
    '',
  ],
];

// The headings the server understands (it reads them regardless of case and punctuation)
const KNOWN_HEADINGS = new Set(Object.values(ALIASES).flat().map(a => a.toLowerCase().replace(/[^a-z0-9]/g, '')));

interface ImportResult {
  total: number;
  imported: number;
  updated: number;
  skipped: number;
  errors: { row: number; code: string; deal: string; reason: string }[];
  warnings: { row: number; code: string; reason: string }[];
}


export default function ImportRecordsModal({
  moduleId,
  onClose,
  onImported,
}: {
  moduleId: ModuleId;
  onClose: () => void;
  onImported: (message: string) => void;
}) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const def = MODULES[moduleId];
  const isPre = moduleId === 'prePayment';
  const noun = isPre ? 'Pre-Payment' : 'Payment Collection';
  const idLabel = isPre ? 'Payment ID' : 'Collection ID';

  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [duplicateStrategy, setDuplicateStrategy] = useState<'skip' | 'update' | 'create_new'>('skip');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0); // rows handled so far
  const [result, setResult] = useState<ImportResult | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [showWarningDetails, setShowWarningDetails] = useState(false);

  const totalRowsDetected = rows.length;
  const recognizedColumns = detectedColumns.filter(c => KNOWN_HEADINGS.has(c.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const nothingSaved = !!result && result.imported === 0 && result.updated === 0 && result.skipped === 0;
  const previewRows = rows.slice(0, 3);

  const downloadSampleTemplate = () => {
    const headers = isPre ? SAMPLE_PRE_PAYMENT_HEADERS : SAMPLE_PAYMENT_COLLECTION_HEADERS;
    const sample = isPre ? SAMPLE_PRE_PAYMENT_ROWS : SAMPLE_PAYMENT_COLLECTION_ROWS;

    const lines = [
      headers.map(h => `"${h}"`).join(','),
      ...sample.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')),
    ];
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${def.slug}_import_template.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const processFile = async (selectedFile: File) => {
    setFile(selectedFile);
    setParsing(true);
    setResult(null);
    setRows([]);
    setDetectedColumns([]);

    try {
      const parsed = await readImportFile(selectedFile);
      setRows(parsed);
      if (parsed.length > 0) {
        setDetectedColumns(Object.keys(parsed[0]));
      } else {
        toast.error('The selected file has no data rows.');
      }
    } catch (err) {
      console.error('File parsing error:', err);
      toast.error(err instanceof Error && err.message ? err.message : 'Failed to parse file. Please verify it is a valid CSV or Excel file.');
      setFile(null);
    } finally {
      setParsing(false);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
    e.target.value = ''; // the same file can be picked again after a change
  };

  // The rows go to the server a few at a time, so a long file never runs into the time limit of one request
  const handleStartImport = async () => {
    if (rows.length === 0) {
      toast.error('Please select a file to import.');
      return;
    }

    setImporting(true);
    setProgress(0);
    const { totals, failure } = await sendInBatches<ImportResult['errors'][number], ImportResult['warnings'][number]>(
      `/api/records/${def.slug}/import`,
      rows,
      duplicateStrategy,
      setProgress,
    );
    setImporting(false);
    if (failure) toast.error(failure);

    // Nothing at all happened (the first request failed): stay on the file instead of showing an empty report
    if (failure && totals.imported + totals.updated + totals.skipped + totals.errors.length === 0) return;
    setResult(totals);
    if (totals.imported > 0 || totals.updated > 0) {
      toast.success(`Import complete! ${totals.imported} records added, ${totals.updated} updated.`);
    } else if (!failure && totals.skipped > 0) {
      toast.error(`Import complete: ${totals.skipped} duplicate records skipped.`);
    }
  };

  const handleFinish = () => {
    if (result && (result.imported > 0 || result.updated > 0)) {
      onImported(`Import completed: ${result.imported} records imported, ${result.updated} updated`);
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-records-title"
        className="bg-white w-full sm:max-w-[820px] max-h-[92vh] rounded-lg shadow-2xl flex flex-col overflow-hidden text-gray-800"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0 bg-white">
          <div>
            <h2 id="import-records-title" className="text-[19px] font-bold text-gray-900 flex items-center gap-2">
              <Upload className="w-5 h-5 text-[#f5b800]" />
              Import {def.heading}
            </h2>
            <p className="text-[12px] text-gray-500 mt-0.5">
              Import {noun.toLowerCase()} records from CSV or Excel (.xlsx) into your CRM pipeline
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={importing}
            aria-label="Close"
            className="text-gray-400 hover:text-black transition-colors disabled:opacity-40"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="overflow-y-auto px-6 py-5 space-y-5 flex-1">
          {/* Download Sample Template Row */}
          {!result && (
            <div className="bg-amber-50/70 border border-amber-200 rounded-md p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[13px]">
              <div className="flex items-start gap-2.5">
                <FileSpreadsheet className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-amber-900">Standard {noun} Format Supported</div>
                  <div className="text-[12px] text-amber-800">
                    Includes {idLabel}, Deals ID, Task Person, Mode, Type, Vendor, {isPre ? 'Work Type, ' : ''}Amount, Date, Status, UTR & Remarks.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={downloadSampleTemplate}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 border border-amber-300 rounded bg-white text-amber-900 font-medium hover:bg-amber-100/50 transition-colors shrink-0 text-[12px]"
              >
                <Download className="w-4 h-4 text-amber-700" />
                Download Template
              </button>
            </div>
          )}

          {/* Results State */}
          {result ? (
            <div className="space-y-4">
              <div className={`${nothingSaved ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'} border rounded-lg p-5 text-center`}>
                {nothingSaved ? <AlertTriangle className="w-12 h-12 text-amber-600 mx-auto mb-2" /> : <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-2" />}
                <h3 className={`text-[17px] font-bold ${nothingSaved ? 'text-amber-900' : 'text-green-900'}`}>{nothingSaved ? 'Nothing was imported' : 'Import Completed'}</h3>
                <p className={`text-[13px] mt-1 ${nothingSaved ? 'text-amber-800' : 'text-green-700'}`}>
                  {nothingSaved ? 'No row of your file could be saved. See the issues below.' : `Finished processing ${result.total} records from your file.`}
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-left">
                  <div className="bg-white border border-green-200 rounded-md p-3">
                    <div className="text-[11px] font-medium text-gray-500 uppercase">Imported</div>
                    <div className="text-[20px] font-bold text-green-600">{result.imported}</div>
                  </div>
                  <div className="bg-white border border-green-200 rounded-md p-3">
                    <div className="text-[11px] font-medium text-gray-500 uppercase">Updated</div>
                    <div className="text-[20px] font-bold text-blue-600">{result.updated}</div>
                  </div>
                  <div className="bg-white border border-green-200 rounded-md p-3">
                    <div className="text-[11px] font-medium text-gray-500 uppercase">Skipped</div>
                    <div className="text-[20px] font-bold text-gray-600">{result.skipped}</div>
                  </div>
                  <div className="bg-white border border-green-200 rounded-md p-3">
                    <div className="text-[11px] font-medium text-gray-500 uppercase">Errors</div>
                    <div className="text-[20px] font-bold text-red-600">{result.errors.length}</div>
                  </div>
                </div>
              </div>

              {/* Warnings: saved, but something in the row was not understood */}
              {result.warnings.length > 0 && (
                <div className="border border-amber-200 rounded-md bg-amber-50/50 p-4">
                  <button
                    type="button"
                    onClick={() => setShowWarningDetails(!showWarningDetails)}
                    className="w-full flex items-center justify-between text-left font-semibold text-amber-900 text-[13px]"
                  >
                    <span className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      {result.warnings.length} notes: saved, but part of a row was not understood (click to {showWarningDetails ? 'hide' : 'view'})
                    </span>
                    <span className="text-amber-700 text-[12px]">{showWarningDetails ? 'Hide' : 'Show'}</span>
                  </button>
                  {showWarningDetails && (
                    <div className="mt-3 max-h-48 overflow-y-auto space-y-1.5 text-[12px] border-t border-amber-200 pt-2 text-amber-900">
                      {result.warnings.map((w, i) => (
                        <div key={i} className="flex gap-2">
                          <span className="font-mono font-bold shrink-0">Row {w.row}:</span>
                          <span>{w.code !== '—' ? `${w.code} — ` : ''}{w.reason}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Error list if any */}
              {result.errors.length > 0 && (
                <div className="border border-red-200 rounded-md bg-red-50/50 p-4">
                  <button
                    type="button"
                    onClick={() => setShowErrorDetails(!showErrorDetails)}
                    className="w-full flex items-center justify-between text-left font-semibold text-red-900 text-[13px]"
                  >
                    <span className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                      {result.errors.length} rows were not saved (click to {showErrorDetails ? 'hide' : 'view'} details)
                    </span>
                    <span className="text-red-700 text-[12px]">{showErrorDetails ? 'Hide' : 'Show'}</span>
                  </button>

                  {showErrorDetails && (
                    <div className="mt-3 max-h-48 overflow-y-auto space-y-1.5 text-[12px] border-t border-red-200 pt-2 text-red-800">
                      {result.errors.map((err, i) => (
                        <div key={i} className="flex gap-2">
                          <span className="font-mono font-bold shrink-0">Row {err.row}:</span>
                          <span>
                            {err.code} ({err.deal}) — {err.reason}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* File Dropzone */}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={IMPORT_FILE_TYPES}
                  onChange={handleFileInputChange}
                  className="hidden"
                />

                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-lg p-6 sm:p-8 text-center cursor-pointer transition-all ${
                    isDragging
                      ? 'border-[#f5b800] bg-amber-50/60 scale-[0.99]'
                      : file
                      ? 'border-green-400 bg-green-50/20'
                      : 'border-gray-300 hover:border-[#f5b800] hover:bg-gray-50/70'
                  }`}
                >
                  {parsing ? (
                    <div className="py-4 flex flex-col items-center">
                      <Loader2 className="w-8 h-8 text-[#f5b800] animate-spin mb-2" />
                      <span className="text-[13px] text-gray-600 font-medium">Reading file structure...</span>
                    </div>
                  ) : file ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-green-700">
                        <FileCheck className="w-6 h-6" />
                      </div>
                      <div className="font-semibold text-gray-900 text-[15px]">{file.name}</div>
                      <div className="text-[12px] text-gray-500">
                        {(file.size / 1024).toFixed(1)} KB · {totalRowsDetected} records detected
                      </div>
                      <span className="mt-2 text-[12px] text-blue-600 underline hover:text-blue-800">
                        Click or drag to choose another file
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 mb-1">
                        <Upload className="w-6 h-6 text-gray-600" />
                      </div>
                      <div className="font-semibold text-gray-800 text-[14px]">
                        Click to browse or drag and drop your file here
                      </div>
                      <div className="text-[12px] text-gray-500">
                        Supports CSV (.csv) or Microsoft Excel (.xlsx, .xls)
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Duplicate Handling Options */}
              {file && totalRowsDetected > 0 && (
                <div className="border border-gray-200 rounded-lg p-4 bg-gray-50/60 space-y-2.5">
                  <div className="text-[13px] font-semibold text-gray-800">
                    Duplicate Record Handling (by {idLabel}):
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[13px]">
                    <label
                      className={`flex items-start gap-2 p-2.5 rounded border cursor-pointer transition-colors ${
                        duplicateStrategy === 'skip'
                          ? 'border-[#f5b800] bg-white text-black shadow-xs'
                          : 'border-gray-200 bg-white/70 text-gray-700 hover:bg-white'
                      }`}
                    >
                      <input
                        type="radio"
                        name="duplicateStrategy"
                        value="skip"
                        checked={duplicateStrategy === 'skip'}
                        onChange={() => setDuplicateStrategy('skip')}
                        className="mt-0.5 accent-[#f5b800]"
                      />
                      <div>
                        <div className="font-medium text-[13px]">Skip duplicates</div>
                        <div className="text-[11px] text-gray-500">Leave existing records unchanged</div>
                      </div>
                    </label>

                    <label
                      className={`flex items-start gap-2 p-2.5 rounded border cursor-pointer transition-colors ${
                        duplicateStrategy === 'update'
                          ? 'border-[#f5b800] bg-white text-black shadow-xs'
                          : 'border-gray-200 bg-white/70 text-gray-700 hover:bg-white'
                      }`}
                    >
                      <input
                        type="radio"
                        name="duplicateStrategy"
                        value="update"
                        checked={duplicateStrategy === 'update'}
                        onChange={() => setDuplicateStrategy('update')}
                        className="mt-0.5 accent-[#f5b800]"
                      />
                      <div>
                        <div className="font-medium text-[13px]">Update existing</div>
                        <div className="text-[11px] text-gray-500">Overwrite with imported data</div>
                      </div>
                    </label>

                    <label
                      className={`flex items-start gap-2 p-2.5 rounded border cursor-pointer transition-colors ${
                        duplicateStrategy === 'create_new'
                          ? 'border-[#f5b800] bg-white text-black shadow-xs'
                          : 'border-gray-200 bg-white/70 text-gray-700 hover:bg-white'
                      }`}
                    >
                      <input
                        type="radio"
                        name="duplicateStrategy"
                        value="create_new"
                        checked={duplicateStrategy === 'create_new'}
                        onChange={() => setDuplicateStrategy('create_new')}
                        className="mt-0.5 accent-[#f5b800]"
                      />
                      <div>
                        <div className="font-medium text-[13px]">Create all as new</div>
                        <div className="text-[11px] text-gray-500">Generate fresh IDs on collision</div>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {/* Data Preview */}
              {previewRows.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="font-semibold text-gray-700">
                      Preview (First {previewRows.length} of {totalRowsDetected} rows):
                    </span>
                    <span className="text-[12px] text-green-700 font-medium">
                      ✓ {recognizedColumns.length} of {detectedColumns.length} columns recognized
                    </span>
                  </div>

                  <div className="border border-gray-200 rounded-md overflow-x-auto max-h-48 text-[12px]">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-gray-100 text-gray-700 font-semibold border-b border-gray-200">
                          <th className="px-3 py-2 whitespace-nowrap">#</th>
                          <th className="px-3 py-2 whitespace-nowrap">{idLabel}</th>
                          <th className="px-3 py-2 whitespace-nowrap">Deals ID</th>
                          <th className="px-3 py-2 whitespace-nowrap">Task Person</th>
                          <th className="px-3 py-2 whitespace-nowrap">Amount</th>
                          <th className="px-3 py-2 whitespace-nowrap">Mode</th>
                          <th className="px-3 py-2 whitespace-nowrap">Type</th>
                          {isPre && <th className="px-3 py-2 whitespace-nowrap">Work Type</th>}
                          <th className="px-3 py-2 whitespace-nowrap">Date</th>
                          <th className="px-3 py-2 whitespace-nowrap">Status</th>
                          <th className="px-3 py-2 whitespace-nowrap">Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((r, idx) => {
                          const pick = (aliases: readonly string[], empty = '—') => getField(r, ...aliases) || empty;
                          const code = pick(ALIASES.code);
                          const deal = pick(ALIASES.deal);
                          const person = pick(ALIASES.taskPerson);
                          const amount = pick(ALIASES.amount);
                          const mode = pick(ALIASES.mode);
                          const type = pick(ALIASES.type);
                          const workType = isPre ? pick(ALIASES.workType) : '';
                          const date = pick(ALIASES.date);
                          const status = pick(ALIASES.status, 'Pending');
                          const remarks = pick(ALIASES.remarks);

                          return (
                            <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50/80">
                              <td className="px-3 py-1.5 text-gray-400 font-mono">{idx + 1}</td>
                              <td className="px-3 py-1.5 font-bold whitespace-nowrap text-gray-900 font-mono">
                                {code}
                              </td>
                              <td className="px-3 py-1.5 font-medium whitespace-nowrap text-gray-900">
                                {deal}
                              </td>
                              <td className="px-3 py-1.5 font-medium whitespace-nowrap text-gray-800">
                                {person}
                              </td>
                              <td className="px-3 py-1.5 whitespace-nowrap font-medium text-gray-900">
                                {amount !== '—' ? `₹${amount}` : '—'}
                              </td>
                              <td className="px-3 py-1.5 whitespace-nowrap text-gray-700">
                                {mode}
                              </td>
                              <td className="px-3 py-1.5 whitespace-nowrap text-gray-700">
                                {type}
                              </td>
                              {isPre && (
                                <td className="px-3 py-1.5 whitespace-nowrap text-gray-700">
                                  {workType}
                                </td>
                              )}
                              <td className="px-3 py-1.5 whitespace-nowrap text-gray-600">
                                {date}
                              </td>
                              <td className="px-3 py-1.5 whitespace-nowrap">
                                <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-900 border border-amber-200">
                                  {status}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 max-w-[200px] truncate text-gray-600">
                                {remarks}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-gray-200 px-6 py-4 flex items-center justify-between bg-gray-50/50">
          <div className="text-[12px] text-gray-500">
            {importing && (
              <span className="flex items-center gap-2 text-amber-700 font-medium">
                <Loader2 className="w-4 h-4 animate-spin text-[#f5b800]" />
                Importing {progress} of {totalRowsDetected} rows, please wait...
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {result ? (
              <button
                type="button"
                onClick={handleFinish}
                className="px-6 h-[40px] rounded-md bg-[#f5b800] hover:bg-[#e0a800] text-black font-semibold text-[14px] transition-colors shadow-xs"
              >
                Done
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={importing}
                  className="px-5 h-[40px] rounded-md border border-gray-300 bg-white text-gray-700 text-[14px] font-medium hover:bg-gray-100 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleStartImport}
                  disabled={!file || totalRowsDetected === 0 || importing}
                  className="px-6 h-[40px] rounded-md bg-[#f5b800] hover:bg-[#e0a800] text-black font-semibold text-[14px] transition-colors shadow-xs disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {importing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Import {totalRowsDetected > 0 ? `${totalRowsDetected} ${def.plural}` : ''}
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

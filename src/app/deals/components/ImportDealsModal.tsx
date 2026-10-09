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
import * as XLSX from 'xlsx';
import { useToast } from '@/components/ui/Toast';

const SAMPLE_CSV_HEADERS = [
  'Record Id',
  'Deal Owner.id',
  'Deal Owner',
  'Amount',
  'Deal Name',
  'Closing Date',
  'Customer Name.id',
  'Customer Name',
  'Stage',
  'Probability (%)',
  'Expected Revenue',
  'Lead Source',
  'Contact Person Name.id',
  'Contact Person Name',
  'Created By.id',
  'Created By',
  'Modified By.id',
  'Modified By',
  'Created Time',
  'Modified Time',
  'Currency',
  'Exchange Rate',
  'Last Activity Time',
  'Lead Conversion Time',
  'Sales Cycle Duration',
  'Overall Sales Duration',
  'Tag',
  'Description',
  'Change Log Time',
  'Locked',
  'Reason For Loss',
  'Lead-Created-Time',
  'Requirements',
  'Lead Type',
  'Type of Lead',
  'Category',
  'Sub Category',
  'City',
  'Assigned Person.id',
  'Assigned Person',
  'Task Person.id',
  'Task Person',
  'Phone',
  'Next Followup Date',
  'Date',
  'Email',
  'Location Link',
  'Business Type',
  'Site Visit Required',
  'Site Visit Date',
  'Preliminary Quote Status',
  'Final Quote Amount',
  'Negotiation Amount',
  'Budget Range',
  'Lead Number',
  'Reason For Deal Loss',
  'Deals ID',
  'Books Estimate ID',
  'Books_Estimate_ID',
  'Project ID',
  'Project Link',
  'Selected Quote.id',
  'Selected Quote',
  'Site Visit Completed Date',
  'Selected Quote ID',
  'Project Location - Country / Region',
  'Project Location - Flat / House No./ Building / Apartment Name',
  'Project Location - Street Address',
  'Project Location - City',
  'Project Location - State / Province',
  'Project Location - Zip / Postal Code',
  'Project Location - Latitude',
  'Project Location - Longitude',
  'Cust ID',
];

const SAMPLE_CSV_ROWS = [
  [
    'zcrm_543227000002798018',
    'zcrm_543227000000281001',
    'Sivabalan 001',
    '600000',
    'VIYANA',
    '2026-06-03',
    'zcrm_543227000002798028',
    'VIYANA',
    'Negotiation/Review',
    '90',
    '540000',
    'PARE Referral',
    '',
    '',
    'zcrm_543227000000281001',
    'Sivabalan 001',
    'zcrm_543227000000281001',
    'Sivabalan 001',
    '2026-05-27 17:26:01',
    '2026-07-31 16:06:55',
    'INR',
    '1.000000000',
    '2026-07-31 16:06:55',
    '15',
    '7',
    '22',
    '',
    '',
    '2026-07-31 16:06:55',
    'false',
    '',
    '2026-05-12 15:31:51',
    'ACOUSTIC BAFFIES',
    'Service',
    'Urgent',
    'Interior Design',
    'Office Interior Design',
    'CHENNAI',
    'zcrm_543227000002493003',
    'Sivabalan 001',
    'zcrm_543227000002493003',
    'Sivabalan 001',
    '9444054429',
    '',
    '2026-05-12',
    'sivabalan.minion001@gmail.com',
    '',
    '',
    'false',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'DL - 1',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ],
  [
    'zcrm_543227000003187153',
    'zcrm_543227000000281001',
    'Sivabalan 001',
    '1000',
    'Rohit',
    '2026-06-26',
    'zcrm_543227000003187151',
    'Rohit',
    'Deal Won',
    '100',
    '1000',
    'Minion',
    'zcrm_543227000003187152',
    'Rohit',
    'zcrm_543227000000281001',
    'Sivabalan 001',
    'zcrm_543227000000281001',
    'Sivabalan 001',
    '2026-06-13 02:23:02',
    '2026-09-05 02:38:04',
    'INR',
    '1.000000000',
    '2026-09-05 02:38:04',
    '35',
    '13',
    '48',
    '',
    '',
    '2026-09-05 02:38:04',
    'false',
    '',
    '2026-05-09 17:56:28',
    'Mineral fiber false ceiling',
    'Service & AMC',
    'Urgent',
    'Ceiling Design & Ambient Lighting',
    'Gypsum Ceiling',
    'chennai',
    'zcrm_543227000002493055',
    'Jaya Jothi 010',
    'zcrm_543227000002493055',
    'Jaya Jothi 010',
    '9841800346',
    '2026-05-12',
    '2026-05-09',
    '',
    '',
    'Service',
    'false',
    '',
    '',
    '',
    '',
    '50K–1L',
    'LMS/A/315',
    '',
    'DL - 4',
    '',
    '',
    '259531000000531004',
    'https://projects.zoho.in/portal/minionsmarthomesolutions#dashboard/259531000000531004',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ],
  [
    'zcrm_543227000005847012',
    'zcrm_543227000000281001',
    'Sivabalan 001',
    '48000',
    'A RATHINAVEL PANDIAN',
    '2026-09-29',
    'zcrm_543227000005847010',
    'A RATHINAVEL PANDIAN',
    'Requirements Collection',
    '10',
    '4800',
    'Indiamart SS LM',
    'zcrm_543227000005847011',
    'A RATHINAVEL PANDIAN',
    'zcrm_543227000000281001',
    'Sivabalan 001',
    'zcrm_543227000000281001',
    'Sivabalan 001',
    '2026-09-22 13:22:06',
    '2026-09-22 13:22:06',
    'INR',
    '1.000000000',
    '2026-09-22 13:22:06',
    '0',
    '7',
    '7',
    '',
    '',
    '2026-09-22 13:22:06',
    'false',
    '',
    '2026-09-22 13:21:37',
    '3D design',
    'Product Supply',
    'Urgent',
    'Interior Design',
    'Residential Interior Design',
    'Chennai',
    'zcrm_543227000002493063',
    'Rahul Rikash 011',
    'zcrm_543227000002493087',
    'Abishek 014',
    '+91 99402 62333',
    '2026-09-22',
    '2026-09-22',
    '',
    '',
    'Service',
    'false',
    '',
    'Not Sent',
    '',
    '',
    '50K–1L',
    'LMS/A/1235',
    '',
    'DL 101',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'MIC - 54',
  ],
];

interface ImportResult {
  total: number;
  imported: number;
  updated: number;
  skipped: number;
  errors: { row: number; dealNumber: string; customerName: string; reason: string }[];
}

export default function ImportDealsModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (message: string) => void;
}) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [duplicateStrategy, setDuplicateStrategy] = useState<'skip' | 'update' | 'create_new'>('skip');
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [totalRowsDetected, setTotalRowsDetected] = useState<number>(0);
  const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  const downloadSampleTemplate = () => {
    const lines = [
      SAMPLE_CSV_HEADERS.map(h => `"${h}"`).join(','),
      ...SAMPLE_CSV_ROWS.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')),
    ];
    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + lines.join('\r\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'deals_import_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const processFile = async (selectedFile: File) => {
    const ext = selectedFile.name.toLowerCase();
    if (!ext.endsWith('.csv') && !ext.endsWith('.xlsx') && !ext.endsWith('.xls')) {
      toast.error('Please upload a .csv, .xlsx, or .xls file.');
      return;
    }

    setFile(selectedFile);
    setParsing(true);
    setResult(null);

    try {
      const buffer = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '', raw: false });

      setTotalRowsDetected(jsonRows.length);
      if (jsonRows.length > 0) {
        setDetectedColumns(Object.keys(jsonRows[0]));
        setPreviewRows(jsonRows.slice(0, 3));
      } else {
        setDetectedColumns([]);
        setPreviewRows([]);
        toast.error('The selected file has no data rows.');
      }
    } catch (err) {
      console.error('File parsing error:', err);
      toast.error('Failed to parse file. Please verify it is a valid CSV or Excel file.');
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
  };

  const handleStartImport = async () => {
    if (!file) {
      toast.error('Please select a file to import.');
      return;
    }

    setImporting(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('duplicateStrategy', duplicateStrategy);

      const res = await fetch('/api/deals/import', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Import failed');
      }

      setResult(data);
      if (data.imported > 0 || data.updated > 0) {
        toast.success(`Import complete! ${data.imported} deals added, ${data.updated} updated.`);
      } else if (data.skipped > 0) {
        toast.error(`Import complete: ${data.skipped} duplicate deals skipped.`);
      }
    } catch (err) {
      console.error('Import error:', err);
      toast.error(err instanceof Error ? err.message : 'An error occurred during import.');
    } finally {
      setImporting(false);
    }
  };

  const handleFinish = () => {
    if (result && (result.imported > 0 || result.updated > 0)) {
      onImported(`Import completed: ${result.imported} deals imported, ${result.updated} updated`);
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-deals-title"
        className="bg-white w-full sm:max-w-[820px] max-h-[92vh] rounded-lg shadow-2xl flex flex-col overflow-hidden text-gray-800"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0 bg-white">
          <div>
            <h2 id="import-deals-title" className="text-[19px] font-bold text-gray-900 flex items-center gap-2">
              <Upload className="w-5 h-5 text-[#f5b800]" />
              Import Deals
            </h2>
            <p className="text-[12px] text-gray-500 mt-0.5">
              Import deals from CSV or Excel (.xlsx) into your CRM pipeline
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
                  <div className="font-semibold text-amber-900">Standard Zoho / Excel Deals Format Supported</div>
                  <div className="text-[12px] text-amber-800">
                    Includes Deals ID, Deal Name, Amount, Stage, Customer, Phone, Requirements, Closing Date & Persons.
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
              <div className="bg-green-50 border border-green-200 rounded-lg p-5 text-center">
                <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-2" />
                <h3 className="text-[17px] font-bold text-green-900">Import Completed</h3>
                <p className="text-[13px] text-green-700 mt-1">
                  Finished processing {result.total} records from your file.
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
                      {result.errors.length} rows encountered issues (Click to {showErrorDetails ? 'hide' : 'view'} details)
                    </span>
                    <span className="text-red-700 text-[12px]">{showErrorDetails ? 'Hide' : 'Show'}</span>
                  </button>

                  {showErrorDetails && (
                    <div className="mt-3 max-h-48 overflow-y-auto space-y-1.5 text-[12px] border-t border-red-200 pt-2 text-red-800">
                      {result.errors.map((err, i) => (
                        <div key={i} className="flex gap-2">
                          <span className="font-mono font-bold shrink-0">Row {err.row}:</span>
                          <span>
                            {err.dealNumber} ({err.customerName}) — {err.reason}
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
                  accept=".csv, .xlsx, .xls"
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
                    Duplicate Deal Handling (by Deals ID / Deal Number):
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
                        <div className="text-[11px] text-gray-500">Leave existing deals unchanged</div>
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
                      ✓ {detectedColumns.length} columns recognized
                    </span>
                  </div>

                  <div className="border border-gray-200 rounded-md overflow-x-auto max-h-48 text-[12px]">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-gray-100 text-gray-700 font-semibold border-b border-gray-200">
                          <th className="px-3 py-2 whitespace-nowrap">#</th>
                          <th className="px-3 py-2 whitespace-nowrap">Deals ID</th>
                          <th className="px-3 py-2 whitespace-nowrap">Deal Name</th>
                          <th className="px-3 py-2 whitespace-nowrap">Customer Name</th>
                          <th className="px-3 py-2 whitespace-nowrap">Phone</th>
                          <th className="px-3 py-2 whitespace-nowrap">Amount</th>
                          <th className="px-3 py-2 whitespace-nowrap">Stage</th>
                          <th className="px-3 py-2 whitespace-nowrap">Closing Date</th>
                          <th className="px-3 py-2 whitespace-nowrap">Requirements</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((r, idx) => {
                          const dealId = String(r['Deals ID'] || r['Deal ID'] || r['Deal Number'] || r['code'] || '—');
                          const dealName = String(r['Deal Name'] || r['Title'] || r['Name'] || '—');
                          const custName = String(r['Customer Name'] || r['Customer'] || r['Contact Person Name'] || '—');
                          const phone = String(r['Phone'] || r['Contact Number'] || '—');
                          const amount = String(r['Amount'] || r['Final Quote Amount'] || r['Value'] || '—');
                          const stage = String(r['Stage'] || r['Deal Status'] || r['Status'] || 'New');
                          const closingDate = String(r['Closing Date'] || r['Expected Close Date'] || '—');
                          const req = String(r['Requirements'] || r['Requirement'] || '—');

                          return (
                            <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50/80">
                              <td className="px-3 py-1.5 text-gray-400 font-mono">{idx + 1}</td>
                              <td className="px-3 py-1.5 font-bold whitespace-nowrap text-gray-900 font-mono">
                                {dealId}
                              </td>
                              <td className="px-3 py-1.5 font-medium whitespace-nowrap text-gray-900">
                                {dealName}
                              </td>
                              <td className="px-3 py-1.5 font-medium whitespace-nowrap text-gray-800">
                                {custName}
                              </td>
                              <td className="px-3 py-1.5 whitespace-nowrap text-gray-700 font-mono">
                                {phone}
                              </td>
                              <td className="px-3 py-1.5 whitespace-nowrap font-medium text-gray-900">
                                {amount ? `₹${amount}` : '—'}
                              </td>
                              <td className="px-3 py-1.5 whitespace-nowrap">
                                <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-900 border border-amber-200">
                                  {stage}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 whitespace-nowrap text-gray-600">
                                {closingDate}
                              </td>
                              <td className="px-3 py-1.5 max-w-[200px] truncate text-gray-600">
                                {req}
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
                Importing records into database, please wait...
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
                      Import {totalRowsDetected > 0 ? `${totalRowsDetected} Deals` : ''}
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

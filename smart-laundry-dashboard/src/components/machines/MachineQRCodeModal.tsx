'use client';

import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import {
  WashingMachine,
  Wind,
  Download,
  Printer,
  RefreshCw,
  QrCode as QrCodeIcon,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { machinesApi } from '@/lib/api';
import type { MachineStatus } from '@/types';

interface MachineQRCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  machine: MachineStatus | null;
}

export function MachineQRCodeModal({
  isOpen,
  onClose,
  machine,
}: MachineQRCodeModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [whatsappUrl, setWhatsappUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch WhatsApp URL from backend and generate QR code
  const generateQRCode = async () => {
    if (!machine) return;

    setLoading(true);
    setError(null);

    try {
      // Get WhatsApp URL from backend (contains the configured phone number)
      const response = await machinesApi.getQRCodeUrl(machine.id);
      setWhatsappUrl(response.whatsappUrl);

      // Generate QR code locally using the URL from backend
      const dataUrl = await QRCode.toDataURL(response.whatsappUrl, {
        width: 400,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      });
      setQrDataUrl(dataUrl);
    } catch (err) {
      console.error('Failed to generate QR code:', err);
      setError('Failed to generate QR code');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && machine) {
      generateQRCode();
    } else {
      // Reset state when modal closes
      setQrDataUrl(null);
      setWhatsappUrl(null);
      setError(null);
    }
  }, [isOpen, machine]);

  const handleDownload = () => {
    if (!qrDataUrl || !machine) return;

    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `qrcode-${machine.id}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    if (!qrDataUrl || !machine) return;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>QR Code - ${machine.name}</title>
            <style>
              body {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                margin: 0;
                padding: 20px;
                font-family: system-ui, -apple-system, sans-serif;
              }
              .container {
                text-align: center;
                border: 2px solid #e5e7eb;
                padding: 40px;
                border-radius: 16px;
              }
              h1 {
                margin: 0 0 8px;
                font-size: 24px;
                color: #111827;
              }
              p {
                margin: 0 0 24px;
                color: #6b7280;
                font-size: 14px;
              }
              img {
                width: 300px;
                height: 300px;
              }
              .instructions {
                margin-top: 24px;
                padding: 16px;
                background: #f3f4f6;
                border-radius: 8px;
                font-size: 12px;
                color: #374151;
                text-align: left;
              }
              @media print {
                body { -webkit-print-color-adjust: exact; }
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>${machine.name}</h1>
              <p>Scan to start your laundry</p>
              <img src="${qrDataUrl}" alt="QR Code" />
              <div class="instructions">
                <strong>Instructions:</strong><br/>
                1. Open your camera or WhatsApp<br/>
                2. Scan this QR code<br/>
                3. Send the message to start the machine
              </div>
            </div>
            <script>
              window.onload = function() {
                window.print();
                window.close();
              };
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
    }
  };

  const handleTestLink = () => {
    if (!whatsappUrl) return;
    window.open(whatsappUrl, '_blank');
  };

  if (!machine) return null;

  const MachineIcon = machine.type === 'washer' ? WashingMachine : Wind;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`QR Code - ${machine.name}`}
      description="Scan this QR code to start the machine via WhatsApp"
      size="md"
    >
      <div className="space-y-6">
        {/* Machine Info Header */}
        <div className="flex items-center justify-center p-4 bg-gray-50 rounded-lg">
          <div
            className={cn(
              'p-3 rounded-lg mr-4',
              machine.type === 'washer'
                ? 'bg-primary-100 text-primary-600'
                : 'bg-warning-100 text-warning-600'
            )}
          >
            <MachineIcon className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{machine.name}</h3>
            <p className="text-sm text-gray-500 capitalize">{machine.type}</p>
          </div>
        </div>

        {/* QR Code Display */}
        <div className="flex flex-col items-center justify-center p-6 bg-white border-2 border-dashed border-gray-200 rounded-xl">
          {loading ? (
            <div className="flex flex-col items-center py-12">
              <Loader2 className="w-12 h-12 text-primary-500 animate-spin mb-4" />
              <p className="text-gray-500">Generating QR code...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center py-12">
              <QrCodeIcon className="w-16 h-16 text-gray-300 mb-4" />
              <p className="text-gray-500 mb-4">{error}</p>
              <Button variant="secondary" size="sm" onClick={generateQRCode}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
            </div>
          ) : qrDataUrl ? (
            <>
              <img
                src={qrDataUrl}
                alt={`QR Code for ${machine.name}`}
                className="w-64 h-64 rounded-lg shadow-sm"
              />
              <p className="text-sm text-gray-500 mt-4 text-center">
                Scan with your phone camera or WhatsApp
              </p>
              {whatsappUrl && (
                <p className="text-xs text-gray-400 mt-2 text-center break-all max-w-xs">
                  {whatsappUrl}
                </p>
              )}
            </>
          ) : null}
        </div>

        {/* Actions */}
        {qrDataUrl && (
          <div className="grid grid-cols-3 gap-3">
            <Button variant="secondary" onClick={handleDownload}>
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
            <Button variant="secondary" onClick={handlePrint}>
              <Printer className="w-4 h-4 mr-2" />
              Print
            </Button>
            <Button variant="secondary" onClick={handleTestLink}>
              <ExternalLink className="w-4 h-4 mr-2" />
              Test
            </Button>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end pt-4 border-t border-gray-200">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

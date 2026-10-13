export type ReceiptSettings = {
  merchant_name: string;
  address: string;
  footer: string;
  paper_width_mm: 58 | 80;
  ble_service_uuid: string;
  ble_characteristic_uuid: string;
};

export type ReceiptLine = {
  name: string;
  quantity: number;
  unitPriceIdr: number;
  lineTotalIdr: number;
  note: string | null;
  modifiers: string[];
};

export type ReceiptData = {
  orderNumber: string;
  customerName: string | null;
  tableLabel: string | null;
  createdAt: string;
  paymentLabel: string;
  paymentStatus: string;
  subtotalIdr: number;
  totalIdr: number;
  lines: ReceiptLine[];
  settings: ReceiptSettings;
};

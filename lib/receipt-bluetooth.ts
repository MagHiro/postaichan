"use client";
import type { ReceiptData } from "./receipt-types";
import { formatEscPos } from "./receipt-escpos";

type Writer = {
  writeValueWithResponse?: (value: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (value: BufferSource) => Promise<void>;
  writeValue?: (value: BufferSource) => Promise<void>;
};
type BluetoothDevice = {
  gatt?: { connect: () => Promise<{ getPrimaryService: (uuid: string) => Promise<{ getCharacteristic: (uuid: string) => Promise<Writer> }> }>; disconnect: () => void };
};
type BluetoothApi = { requestDevice: (options: { acceptAllDevices: boolean; optionalServices: string[] }) => Promise<BluetoothDevice> };

// Call this function DIRECTLY from an onClick handler: device selection requires
// transient user activation on Chrome Android/Desktop and is unavailable on iOS Safari.
export async function printBluetoothReceipt(receipt: ReceiptData) {
  const bluetooth = (navigator as Navigator & { bluetooth?: BluetoothApi }).bluetooth;
  if (!bluetooth) throw new Error("Browser ini tidak mendukung Bluetooth LE. Gunakan Cetak biasa (AirPrint/print dialog).");
  const serviceUuid = receipt.settings.ble_service_uuid;
  const characteristicUuid = receipt.settings.ble_characteristic_uuid;
  const device = await bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [serviceUuid] });
  if (!device.gatt) throw new Error("Printer tidak memiliki layanan Bluetooth GATT.");
  const server = await device.gatt.connect();
  try {
    const service = await server.getPrimaryService(serviceUuid);
    const characteristic = await service.getCharacteristic(characteristicUuid);
    const write = characteristic.writeValueWithoutResponse?.bind(characteristic)
      ?? characteristic.writeValueWithResponse?.bind(characteristic)
      ?? characteristic.writeValue?.bind(characteristic);
    if (!write) throw new Error("Karakteristik printer tidak mendukung penulisan.");
    const bytes = formatEscPos(receipt);
    // Conservative 20-byte BLE GATT packets maximize compatibility for small MTUs.
    for (let i = 0; i < bytes.length; i += 20) {
      const part = Uint8Array.from(bytes.slice(i, i + 20));
      await write(part);
      if (i + 20 < bytes.length) await new Promise<void>(resolve => window.setTimeout(resolve, 15));
    }
  } finally {
    device.gatt.disconnect();
  }
}

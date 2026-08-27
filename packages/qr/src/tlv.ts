/**
 * EMVCo QR TLV parser.
 *
 * EMVCo payloads are ASCII strings of Tag-Length-Value records:
 *   - 2-char tag (numeric, e.g. "52", "59", "63"),
 *   - 2-char DECIMAL length (number of characters in the value),
 *   - value: `length` ASCII characters.
 * Only the CRC field value is hexadecimal.
 */
export interface EmvcoField {
  tag: string;
  value: string;
}

export interface TlvParseResult {
  fields: EmvcoField[];
  errors: string[];
}

export function parseTlv(s: string): TlvParseResult {
  const fields: EmvcoField[] = [];
  const errors: string[] = [];
  let i = 0;

  while (i < s.length) {
    if (s.length - i < 4) {
      errors.push(`truncated field at offset ${i}`);
      break;
    }
    const tag = s.slice(i, i + 2);
    const lengthStr = s.slice(i + 2, i + 4);
    const len = parseInt(lengthStr, 10);
    if (Number.isNaN(len)) {
      errors.push(`invalid length '${lengthStr}' at offset ${i + 2}`);
      break;
    }
    const valueStart = i + 4;
    const valueEnd = valueStart + len;
    if (valueEnd > s.length) {
      errors.push(`field ${tag} declares length ${len} but data ends at ${s.length}`);
      break;
    }
    fields.push({ tag, value: s.slice(valueStart, valueEnd) });
    i = valueEnd;
  }

  return { fields, errors };
}

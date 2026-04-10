/*
 * Copyright (c) 2016-present Invertase Limited
 */
export function isNull(value: any): value is null {
  return value === null;
}

export function isObject(value: any): value is object {
  return value ? typeof value === 'object' && !Array.isArray(value) && !isNull(value) : false;
}

export function isFunction(value: any): value is Function {
  return value ? typeof value === 'function' : false;
}

export function isString(value: any): value is string {
  return typeof value === 'string';
}

export function isNumber(value: any): value is number {
  return typeof value === 'number';
}

export function isBoolean(value: any): value is boolean {
  return typeof value === 'boolean';
}

export function isArray(value: any): value is Array<any> {
  return Array.isArray(value);
}

export function isArrayOfStrings(value: any): value is Array<string> {
  if (!isArray(value)) return false;
  for (let i = 0; i < value.length; i++) {
    if (!isString(value[i])) return false;
  }
  return true;
}

export function isUndefined(value: any): value is undefined {
  return value === undefined;
}

export function objectKeyValuesAreStrings(value: object): value is { [key: string]: string } {
  if (!isObject(value)) {
    return false;
  }

  const entries = Object.entries(value);

  for (let i = 0; i < entries.length; i++) {
    const [key, entryValue] = entries[i];
    if (!isString(key) || !isString(entryValue)) {
      return false;
    }
  }

  return true;
}

/**
 * /^[a-zA-Z0-9_]+$/
 *
 * @param value
 * @returns {boolean}
 */
const AlphaNumericUnderscore = /^[a-zA-Z0-9_]+$/;

export function isAlphaNumericUnderscore(value: string): boolean {
  return AlphaNumericUnderscore.test(value);
}

/**
 * URL test
 * @param url
 * @returns {boolean}
 */
const IS_VALID_URL_REGEX = /^(http|https):\/\/[^ "]+$/;

export function isValidUrl(url: string): boolean {
  return IS_VALID_URL_REGEX.test(url);
}

export function isValidEnum(value: any, enumType: Record<string, any>): boolean {
  // Filter out reverse-mapped string keys that TypeScript adds to numeric enums.
  // In a numeric enum { A=0, B=1 }, Object.values() returns [0, 1, "A", "B"].
  // The reverse-mapped string "A" satisfies typeof enumType["A"] === 'number',
  // whereas real string enum values (e.g., TimeUnit.SECONDS = 'SECONDS')
  // satisfy typeof enumType["SECONDS"] === 'string', so they are kept.
  const values = Object.values(enumType).filter(
    v => typeof v !== 'string' || typeof enumType[v] !== 'number',
  );
  return values.includes(value);
}

export function getNumericEnumValues(enumType: Record<string, any>): number[] {
  return Object.values(enumType).filter((v): v is number => typeof v === 'number');
}

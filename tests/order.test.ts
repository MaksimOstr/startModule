import { calculateOrderTotal } from '../src/index';

describe('Order Calculation Contract', () => {
  describe('Standard calculations', () => {
    test('should calculate total with 20% tax', () => {
      expect(calculateOrderTotal(100, 2, 0.2)).toBe(240);
    });

    test('should calculate total with 0% tax', () => {
      expect(calculateOrderTotal(100, 2, 0)).toBe(200);
    });

    test('should handle floating point tax', () => {
      expect(calculateOrderTotal(10, 1, 0.05)).toBe(10.5);
    });
  });

  describe('Validation (Negative Tests)', () => {
    test('should throw error if price is negative', () => {
      expect(() => calculateOrderTotal(-50, 1, 0.2)).toThrow('Price cannot be negative');
    });

    test('should throw error if quantity is zero', () => {
      expect(() => calculateOrderTotal(100, 0, 0.2)).toThrow('Quantity must be greater than zero');
    });

    test('should throw error if tax rate is negative', () => {
      expect(() => calculateOrderTotal(100, 1, -0.1)).toThrow('Tax rate cannot be negative');
    });
  });
});

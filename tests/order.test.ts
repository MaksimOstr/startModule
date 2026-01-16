import { calculateOrderTotal } from '../src/index';

describe('Order Calculation Contract', () => {
  describe('Standard calculations', () => {
    test('should calculate total correctly for integers', () => {
      const result = calculateOrderTotal(100, 2);
      expect(result).toBe(200);
    });

    test('should handle floating point math correctly', () => {
      expect(calculateOrderTotal(10.5, 3)).toBe(31.5);
    });

    test('should round to 2 decimal places', () => {
      expect(calculateOrderTotal(10.123, 1)).toBe(10.12);
    });
  });
  describe('Validation (Negative Tests)', () => {
    test('should throw error if price is negative', () => {
      expect(() => calculateOrderTotal(-50, 1)).toThrow('Price cannot be negative');
    });

    test('should throw error if quantity is zero', () => {
      expect(() => calculateOrderTotal(100, 0)).toThrow('Quantity must be greater than zero');
    });

    test('should throw error if quantity is negative', () => {
      expect(() => calculateOrderTotal(100, -5)).toThrow('Quantity must be greater than zero');
    });
  });
});

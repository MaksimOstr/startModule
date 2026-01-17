import 'dotenv/config';

export const calculateOrderTotal = (price: number, quantity: number, taxRate: number): number => {
  if (price < 0) {
    throw new Error('Price cannot be negative');
  }

  if (quantity <= 0) {
    throw new Error('Quantity must be greater than zero');
  }

  if (taxRate < 0) {
    throw new Error('Tax rate cannot be negative');
  }

  const subtotal = price * quantity;
  const total = subtotal * (1 + taxRate);

  return Math.round(total * 100) / 100;
};

const currentTax = Number(process.env.TAX_RATE || 0);
console.log(calculateOrderTotal(5, 10, currentTax));

export const calculateOrderTotal = (price: number, quantity: number): number => {
  if (price < 0) {
    throw new Error('Price cannot be negative');
  }

  if (quantity <= 0) {
    throw new Error('Quantity must be greater than zero');
  }

  const total = price * quantity;
  return Math.round(total * 100) / 100;
};

const result = calculateOrderTotal(5, 10);
console.log(result);

## Order total counter

## Quick start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start application:
   ```bash
   npm run start
   ```

## Output examples
- **Input data:** `price = 5`, `quantity = 10`
- **Output data:** `50`

## Limitations / Assumptions
- Fixed rounding strategy (2 decimal places)
- Does not handle discounts or taxes
- Inputs `price` and `quantity` are valid numbers (no strings, null, undefined)
- Price is non-negative; quantity is strictly positive
- Only supports single-item orders
- Function is expected to be pure and deterministic

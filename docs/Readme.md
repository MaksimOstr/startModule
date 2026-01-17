## Order total counter

## Quick start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `.env` file in the root folder and set the environment variables specified in `.env.example`

3. Start application:
   ```bash
   npm run start
   ```

## Output examples
- **Input data:** `price = 5`, `quantity = 10, tax rate = 0.2`
- **Output data:** `60`

## Limitations / Assumptions
- Fixed rounding strategy (2 decimal places)
- Inputs `price` and `quantity` are valid numbers (no strings, null, undefined)
- Price is non-negative; quantity is strictly positive, tax rate is strictly positive
- Only supports single-item orders
- Function is expected to be pure and deterministic

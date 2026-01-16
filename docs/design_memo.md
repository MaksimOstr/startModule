## Mini Design Memo

### Key invariants
- Price must be strictly positive
- Quantity must be greater than zero
- Total order value is calculated as price x quantity
- The returned total is rounded to two decimal places
- The function is pure and deterministic for the same inputs

### Failure modes
- Negative price input -> throws 'Price cannot be negative'
- Zero or negative quantity -> throws 'Quantity must be greater than zero'
- Large numbers exceeding integer limits

### Testing
- Added unit tests to verify correct total calculation for valid inputs
- Tested error handling for negative price values
- Tested error handling for zero and negative quantity values
- Verified rounding behavior for floating-point results

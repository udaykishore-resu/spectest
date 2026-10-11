package pricing

import "errors"

// Discount returns the price after a percentage discount.
func Discount(price float64, percent int) (float64, error) {
	if percent < 0 || percent > 100 {
		return 0, errors.New("percent must be between 0 and 100")
	}
	return price * float64(100-percent) / 100, nil
}

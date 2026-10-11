package com.shop.pricing;

import java.math.BigDecimal;

public class PriceCalculator {
    public BigDecimal discount(BigDecimal price, int percent) {
        if (percent < 0 || percent > 100) {
            throw new IllegalArgumentException("percent must be between 0 and 100");
        }
        return price.multiply(BigDecimal.valueOf(100 - percent)).divide(BigDecimal.valueOf(100));
    }
}

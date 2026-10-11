using System;

namespace Shop.Pricing
{
    public class PriceCalculator
    {
        public decimal Rate { get; set; }

        public decimal Discount(decimal price, int percent)
        {
            if (percent < 0 || percent > 100) throw new ArgumentOutOfRangeException(nameof(percent));
            return price * (100 - percent) / 100m;
        }
    }
}

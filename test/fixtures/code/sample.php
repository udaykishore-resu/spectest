<?php
namespace Shop\Pricing;

class PriceCalculator
{
    public function discount(float $price, int $percent): float
    {
        if ($percent < 0 || $percent > 100) {
            throw new \InvalidArgumentException('percent must be between 0 and 100');
        }
        return $price * (100 - $percent) / 100;
    }
}

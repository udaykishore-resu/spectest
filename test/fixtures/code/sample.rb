class PriceCalculator
  attr_reader :rate

  def discount(price, percent)
    raise ArgumentError, 'percent must be between 0 and 100' unless (0..100).cover?(percent)
    price * (100 - percent) / 100.0
  end
end

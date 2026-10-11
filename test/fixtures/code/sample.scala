object Pricing {
  def discount(price: BigDecimal, percent: Int): BigDecimal = {
    require(percent >= 0 && percent <= 100, "percent must be between 0 and 100")
    price * (100 - percent) / 100
  }
}

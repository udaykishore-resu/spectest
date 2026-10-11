data class Money(val cents: Long)

fun discount(price: Money, percent: Int): Money {
    require(percent in 0..100) { "percent must be between 0 and 100" }
    val result = price.cents * (100 - percent) / 100
    return Money(result)
}

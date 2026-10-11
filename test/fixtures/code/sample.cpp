#include <stdexcept>
#include <vector>

namespace pricing {
double discount(double price, int percent) {
    if (percent < 0 || percent > 100) throw std::invalid_argument("percent must be between 0 and 100");
    return price * (100 - percent) / 100.0;
}
}

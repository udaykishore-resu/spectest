#include <stdio.h>
#include <stdbool.h>

bool discount(double price, int percent, double *out) {
    if (percent < 0 || percent > 100) {
        return false;
    }
    *out = price * (100 - percent) / 100.0;
    return true;
}

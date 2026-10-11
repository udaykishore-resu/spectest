def discount(price: float, percent: int) -> float:
    if percent < 0 or percent > 100:
        raise ValueError("percent must be between 0 and 100")
    return price * (100 - percent) / 100


class Cart:
    def __init__(self):
        self.items = []

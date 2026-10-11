export interface Item {
  price: number;
  qty: number;
}

export function total(items: Item[], discount: number): number {
  const sum = items.reduce((acc, i) => acc + i.price * i.qty, 0);
  return sum * (1 - discount);
}

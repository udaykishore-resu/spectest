const total = (items, discount) => {
  const sum = items.reduce((acc, i) => acc + i.price * i.qty, 0);
  if (discount < 0 || discount > 1) throw new RangeError('discount must be between 0 and 1');
  return sum * (1 - discount);
};

module.exports = { total };

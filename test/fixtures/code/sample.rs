pub fn discount(price: f64, percent: u32) -> Result<f64, String> {
    if percent > 100 {
        return Err(format!("percent {} is over 100", percent));
    }
    let mut result = price;
    result *= (100 - percent) as f64 / 100.0;
    Ok(result)
}

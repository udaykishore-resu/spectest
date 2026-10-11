package org.junit.jupiter.api;

/** Stand-in with the one method the generated tests call. */
public final class Assertions {
  private Assertions() {}

  public static <V> V fail(String message) {
    throw new AssertionError(message);
  }
}

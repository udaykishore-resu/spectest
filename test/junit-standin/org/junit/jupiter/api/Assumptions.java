package org.junit.jupiter.api;

/** Stand-in with the one method the generated tests call. */
public final class Assumptions {
  private Assumptions() {}

  public static final class Aborted extends RuntimeException {
    private static final long serialVersionUID = 1L;

    public Aborted(String message) {
      super(message);
    }
  }

  public static void assumeTrue(boolean condition, String message) {
    if (!condition) throw new Aborted(message);
  }
}

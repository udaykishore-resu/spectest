import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.Comparator;

/** Runs every @Test method of the named class and prints one line per test. Exit code 1 when any test fails. */
public final class Runner {
  public static void main(String[] args) throws Exception {
    Class<?> cls = Class.forName(args[0]);
    Constructor<?> ctor = cls.getDeclaredConstructor();
    ctor.setAccessible(true);
    Method[] methods = cls.getDeclaredMethods();
    Arrays.sort(methods, Comparator.comparing(Method::getName));
    int pass = 0, fail = 0, skip = 0;
    for (Method m : methods) {
      if (!m.isAnnotationPresent(org.junit.jupiter.api.Test.class)) continue;
      m.setAccessible(true);
      try {
        m.invoke(ctor.newInstance());
        pass++;
        System.out.println("PASS " + m.getName());
      } catch (InvocationTargetException e) {
        Throwable c = e.getCause();
        if (c instanceof org.junit.jupiter.api.Assumptions.Aborted) {
          skip++;
          System.out.println("SKIP " + m.getName());
        } else {
          fail++;
          System.out.println("FAIL " + m.getName() + ": " + String.valueOf(c).split("\n")[0]);
        }
      }
    }
    System.out.println(pass + " passed, " + fail + " failed, " + skip + " skipped");
    System.exit(fail == 0 ? 0 : 1);
  }
}

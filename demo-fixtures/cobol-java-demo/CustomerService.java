/**
 * CustomerService.java — demo fixture
 * A deliberately risky Java 8 service class.
 * Contains: deep nesting, @Deprecated usage, anti-patterns, no tests, TODO comments.
 */

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;

public class CustomerService {

    // TODO: externalize DB connection string — hardcoded for now
    private static final String DB_URL = "jdbc:db2://192.168.1.100:5000/CUSTDB";

    @Deprecated
    private Connection legacyConnection;

    /**
     * @Deprecated — use CustomerRepository instead.
     * Retrieves customer by ID using raw JDBC.
     */
    @Deprecated
    public Customer getCustomerById(int customerId) {
        try {
            // FIXME: connection is never closed — resource leak
            legacyConnection = DriverManager.getConnection(DB_URL, "admin", "password123");
            PreparedStatement ps = legacyConnection.prepareStatement(
                "SELECT * FROM CUSTOMERS WHERE ID = ?"
            );
            ps.setInt(1, customerId);
            ResultSet rs = ps.executeQuery();

            if (rs.next()) {
                Customer c = new Customer();
                c.setId(rs.getInt("ID"));
                c.setName(rs.getString("NAME"));
                c.setBalance(rs.getDouble("BALANCE"));
                c.setStatus(rs.getString("STATUS"));

                // Deep nesting starts here
                if (c.getStatus() != null) {
                    if (c.getStatus().equals("A")) {
                        if (c.getBalance() >= 0) {
                            if (c.getBalance() > 10000) {
                                if (!c.getName().isEmpty()) {
                                    // TODO: add premium tier logic
                                    c.setPremium(true);
                                }
                            }
                        } else {
                            if (c.getBalance() < -500) {
                                if (c.getBalance() < -1000) {
                                    // Deep level 7
                                    System.exit(1); // HACK: terminate on critical overdraft
                                }
                            }
                        }
                    }
                }
                return c;
            }
        } catch (Exception e) {
            // TODO: log properly
            e.printStackTrace();
        }
        return null;
    }

    /**
     * Process a batch of customer IDs — uses Thread.sleep anti-pattern.
     */
    public List<Customer> batchProcess(List<Integer> ids) {
        List<Customer> results = new ArrayList<>();
        for (int id : ids) {
            results.add(getCustomerById(id));
            try {
                Thread.sleep(100); // FIXME: replace with proper rate limiting
            } catch (Exception e) {
                // swallow
            }
        }
        return results;
    }

    /** Legacy finalizer — deprecated JVM cleanup hook */
    @Override
    @Deprecated
    protected void finalize() throws Throwable {
        if (legacyConnection != null) {
            legacyConnection.close();
        }
        super.finalize();
    }
}

/**
 * Customer.java — demo fixture
 * Plain Java 8 bean.  Imports CustomerService (creates a dep edge).
 */
public class Customer {
    private int    id;
    private String name;
    private double balance;
    private String status;
    private boolean premium;

    // Getters / setters omitted for brevity — use Lombok in modern code
    public int    getId()        { return id; }
    public void   setId(int id)  { this.id = id; }
    public String getName()      { return name; }
    public void   setName(String name) { this.name = name; }
    public double getBalance()   { return balance; }
    public void   setBalance(double b) { this.balance = b; }
    public String getStatus()    { return status; }
    public void   setStatus(String s)  { this.status = s; }
    public boolean isPremium()   { return premium; }
    public void   setPremium(boolean p) { this.premium = p; }
}

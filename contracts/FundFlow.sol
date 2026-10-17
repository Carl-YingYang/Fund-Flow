// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract FundFlow {
    enum Role { None, Member, Treasurer, Adviser, Admin }
    enum RequestStatus { Pending, PartiallyApproved, Approved, Rejected, Released, Cancelled }

    struct Member {
        string name;
        address wallet;
        Role role;
        bool active;
        bool registered;
        uint256 registeredAt;
    }

    struct FundRequest {
        uint256 id;
        address requester;
        address recipient;
        uint256 amount;
        string purpose;
        string category;
        bool treasurerApproved;
        bool adviserApproved;
        bool requiresAdviser;
        RequestStatus status;
        uint256 createdAt;
        uint256 releasedAt;
        string rejectionReason;
    }

    address public admin;
    uint256 public memberCount;
    uint256 public requestCount;
    uint256 public largeRequestThreshold = 1 ether;
    bool private locked;

    mapping(address => Member) private members;
    mapping(uint256 => FundRequest) private requests;
    address[] private memberAddresses;

    event MemberAdded(address indexed wallet, string name, Role role);
    event MemberUpdated(address indexed wallet);
    event RequestCreated(uint256 indexed requestId, address indexed requester, uint256 amount);
    event RequestApproved(uint256 indexed requestId, address indexed approver);
    event RequestRejected(uint256 indexed requestId, address indexed rejectedBy, string reason);
    event RequestReleased(uint256 indexed requestId, address indexed recipient, uint256 amount);
    event RequestCancelled(uint256 indexed requestId);
    event FundsDeposited(address indexed sender, uint256 amount);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can perform this action");
        _;
    }

    modifier onlyActiveRole(Role requiredRole) {
        require(members[msg.sender].registered, "Account not registered");
        require(members[msg.sender].active, "Account is inactive");
        require(members[msg.sender].role == requiredRole, "Incorrect account role");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "Transaction is currently locked");
        locked = true;
        _;
        locked = false;
    }

    constructor() {
        admin = msg.sender;
        members[msg.sender] = Member({
            name: "David Ponce",
            wallet: msg.sender,
            role: Role.Admin,
            active: true,
            registered: true,
            registeredAt: block.timestamp
        });
        memberAddresses.push(msg.sender);
        memberCount = 1;
        emit MemberAdded(msg.sender, "David Ponce", Role.Admin);
    }

    receive() external payable {
        emit FundsDeposited(msg.sender, msg.value);
    }

    function addMember(string memory name, address wallet, Role role) external onlyAdmin {
        require(wallet != address(0), "Invalid wallet address");
        require(bytes(name).length > 0, "Name is required");
        // Admin is the contract owner set in the constructor, not a delegatable role.
        require(role != Role.None && role != Role.Admin, "Invalid member role");
        require(!members[wallet].registered, "Wallet already registered");
        members[wallet] = Member({
            name: name,
            wallet: wallet,
            role: role,
            active: true,
            registered: true,
            registeredAt: block.timestamp
        });
        memberAddresses.push(wallet);
        memberCount++;
        emit MemberAdded(wallet, name, role);
    }

    function updateMemberName(address wallet, string memory newName) external onlyAdmin {
        require(members[wallet].registered, "Member not found");
        require(bytes(newName).length > 0, "Name is required");
        members[wallet].name = newName;
        emit MemberUpdated(wallet);
    }

    function updateMemberRole(address wallet, Role newRole) external onlyAdmin {
        require(members[wallet].registered, "Member not found");
        require(newRole != Role.None && newRole != Role.Admin, "Invalid member role");
        require(wallet != admin, "Cannot change main admin");
        members[wallet].role = newRole;
        emit MemberUpdated(wallet);
    }

    function setMemberStatus(address wallet, bool active) external onlyAdmin {
        require(members[wallet].registered, "Member not found");
        require(wallet != admin, "Cannot deactivate main admin");
        members[wallet].active = active;
        emit MemberUpdated(wallet);
    }

    function createFundRequest(address recipient, uint256 amount, string memory purpose, string memory category)
        external onlyActiveRole(Role.Member)
    {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be greater than zero");
        require(bytes(purpose).length > 0, "Purpose is required");
        require(bytes(category).length > 0, "Category is required");
        requestCount++;
        bool needsAdviser = amount > largeRequestThreshold;
        requests[requestCount] = FundRequest({
            id: requestCount,
            requester: msg.sender,
            recipient: recipient,
            amount: amount,
            purpose: purpose,
            category: category,
            treasurerApproved: false,
            adviserApproved: false,
            requiresAdviser: needsAdviser,
            status: RequestStatus.Pending,
            createdAt: block.timestamp,
            releasedAt: 0,
            rejectionReason: ""
        });
        emit RequestCreated(requestCount, msg.sender, amount);
    }

    function approveAsTreasurer(uint256 requestId) external onlyActiveRole(Role.Treasurer) {
        FundRequest storage selectedRequest = requests[requestId];
        require(selectedRequest.id != 0, "Request not found");
        require(selectedRequest.status == RequestStatus.Pending, "Request cannot be approved");
        require(!selectedRequest.treasurerApproved, "Already approved by Treasurer");
        selectedRequest.treasurerApproved = true;
        selectedRequest.status = selectedRequest.requiresAdviser ? RequestStatus.PartiallyApproved : RequestStatus.Approved;
        emit RequestApproved(requestId, msg.sender);
    }

    function approveAsAdviser(uint256 requestId) external onlyActiveRole(Role.Adviser) {
        FundRequest storage selectedRequest = requests[requestId];
        require(selectedRequest.id != 0, "Request not found");
        require(selectedRequest.requiresAdviser, "Adviser approval not required");
        require(selectedRequest.status == RequestStatus.PartiallyApproved, "Treasurer approval is required first");
        require(!selectedRequest.adviserApproved, "Already approved by Adviser");
        selectedRequest.adviserApproved = true;
        selectedRequest.status = RequestStatus.Approved;
        emit RequestApproved(requestId, msg.sender);
    }

    function rejectRequest(uint256 requestId, string memory reason) external {
        require(members[msg.sender].registered, "Account not registered");
        require(members[msg.sender].active, "Account is inactive");
        Role senderRole = members[msg.sender].role;
        require(senderRole == Role.Treasurer || senderRole == Role.Adviser, "Not authorized to reject");
        require(bytes(reason).length > 0, "Reason is required");
        FundRequest storage selectedRequest = requests[requestId];
        require(selectedRequest.id != 0, "Request not found");
        require(selectedRequest.status == RequestStatus.Pending || selectedRequest.status == RequestStatus.PartiallyApproved, "Request cannot be rejected");
        selectedRequest.status = RequestStatus.Rejected;
        selectedRequest.rejectionReason = reason;
        emit RequestRejected(requestId, msg.sender, reason);
    }

    function cancelRequest(uint256 requestId) external {
        FundRequest storage selectedRequest = requests[requestId];
        require(selectedRequest.id != 0, "Request not found");
        require(selectedRequest.requester == msg.sender, "Not your request");
        require(selectedRequest.status == RequestStatus.Pending, "Request cannot be cancelled");
        selectedRequest.status = RequestStatus.Cancelled;
        emit RequestCancelled(requestId);
    }

    function releaseFunds(uint256 requestId) external onlyActiveRole(Role.Treasurer) nonReentrant {
        FundRequest storage selectedRequest = requests[requestId];
        require(selectedRequest.id != 0, "Request not found");
        require(selectedRequest.status == RequestStatus.Approved, "Request is not approved");
        require(address(this).balance >= selectedRequest.amount, "Insufficient contract balance");
        selectedRequest.status = RequestStatus.Released;
        selectedRequest.releasedAt = block.timestamp;
        (bool success, ) = payable(selectedRequest.recipient).call{value: selectedRequest.amount}("");
        require(success, "Fund transfer failed");
        emit RequestReleased(requestId, selectedRequest.recipient, selectedRequest.amount);
    }

    function updateLargeRequestThreshold(uint256 newThreshold) external onlyAdmin {
        require(newThreshold > 0, "Threshold must be greater than zero");
        largeRequestThreshold = newThreshold;
    }

    function getMember(address wallet) external view returns (Member memory) {
        require(members[wallet].registered, "Member not found");
        return members[wallet];
    }

    function getMemberAddresses() external view returns (address[] memory) { return memberAddresses; }
    function getFundRequest(uint256 requestId) external view returns (FundRequest memory) {
        require(requests[requestId].id != 0, "Request not found");
        return requests[requestId];
    }
    function getContractBalance() external view returns (uint256) { return address(this).balance; }
}

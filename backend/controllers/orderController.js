const catchAsyncError = require('../middlewares/catchAsyncError');
const Order = require('../models/orderModel');
const Product = require('../models/productModel');
const ErrorHandler = require('../utils/errorHandler');
const User = require('../models/userModel');
const sendEmail = require('../utils/email');



//Create New Order - api/v1/order/new
exports.newOrder = catchAsyncError(async (req, res, next) => {
    const generateUniqueCode = () =>
        Math.random().toString(36).substring(2, 10).toUpperCase();

    const {
        orderItems,
        shippingInfo,
        itemsPrice,
        taxPrice,
        shippingPrice,
        totalPrice,
        paymentInfo
    } = req.body;

    const order = await Order.create({
        orderItems,
        shippingInfo,
        itemsPrice,
        taxPrice,
        shippingPrice,
        totalPrice,
        paymentInfo,
        paidAt: Date.now(),
        user: req.user.id,
        uniquecode: generateUniqueCode()
    });

    // 📧 Fetch user email and name
    const user = await User.findById(req.user.id);

    // 📦 Build product list for email
    const productList = orderItems.map(item => {
        return `- ${item.name} (Qty: ${item.quantity}) — $${item.price}`;
    }).join('\n');

    const message = `
Hi ${user.name},

🎉 Thank you for your purchase!

🛍️ Order Details:
${productList}

📦 Total: $${totalPrice}

We appreciate your business!
- The Team
    `;

    await sendEmail({
        email: user.email,
        subject: 'Thank You for Your Purchase!',
        message
    });

    res.status(200).json({
        success: true,
        order
    });
});

//Get Single Order - api/v1/order/:id
exports.getSingleOrder = catchAsyncError(async (req, res, next) => {
    const order = await Order.findById(req.params.id).populate('user', 'name email');
    if(!order) {
        return next(new ErrorHandler(`Order not found with this id: ${req.params.id}`, 404))
    }

    res.status(200).json({
        success: true,
        order
    })
})

//Get Loggedin User Orders - /api/v1/myorders
exports.myOrders = catchAsyncError(async (req, res, next) => {
    const orders = await Order.find({user: req.user.id});

    res.status(200).json({
        success: true,
        orders
    })
})

//Admin: Get All Orders - api/v1/orders
exports.orders = catchAsyncError(async (req, res, next) => {
    const orders = await Order.find();

    let totalAmount = 0;

    orders.forEach(order => {
        totalAmount += order.totalPrice
    })

    res.status(200).json({
        success: true,
        totalAmount,
        orders
    })
})

//Admin: Update Order / Order Status - api/v1/order/:id
exports.updateOrder = catchAsyncError(async (req, res, next) => {
    const order = await Order.findById(req.params.id).populate('user');

    if (!order) {
        return next(new ErrorHandler('Order not found', 404));
    }

    if (order.orderStatus === 'Delivered') {
        return next(new ErrorHandler('Order has already been delivered!', 400));
    }

    // Update stock
    for (const item of order.orderItems) {
        await updateStock(item.product, item.quantity);
    }

    order.orderStatus = req.body.orderStatus;


    if (req.body.orderStatus === 'Shipped') {
        const productList = order.orderItems.map(item => {
            return `- ${item.name} (Qty: ${item.quantity}) — $${item.price}`;
        }).join('\n');
    
        const message = `
    Hi ${order.user.name},
    
    🚚 Your order has been shipped and is on the way!
    
    🛍️ Order Details:
    ${productList}
    
    📍 Shipping To:
    ${order.shippingInfo.address}, ${order.shippingInfo.city}, ${order.shippingInfo.country}
    
    We’ll notify you again once your order is delivered.
    
    Thank you for shopping with us!
    – The Team
        `;
    
        await sendEmail({
            email: order.user.email,
            subject: 'Your Order Has Been Shipped!',
            message
        });
    }

    if (req.body.orderStatus === 'Delivered') {
        order.deliveredAt = Date.now();

        // 📦 Construct product details as a list
        const productList = order.orderItems.map(item => {
            return `- ${item.name} (Qty: ${item.quantity}) — $${item.price}`;
        }).join('\n');

        // 📧 Email with product details & unique code
        const emailMessage = `
Hi ${order.user.name},

Your order has been delivered successfully.

🛒 Order Details:
${productList}

🔐 Your Unique Code: ${order.uniquecode}

You can use this code to review the products you’ve received.

Thanks for shopping with us!
- The Team
        `;

        await sendEmail({
            email: order.user.email,
            subject: 'Your Order Has Been Delivered',
            message: emailMessage
        });
    }

    await order.save();

    res.status(200).json({
        success: true,
        message: 'Order updated successfully'
    });
});

// Update stock helper
async function updateStock(productId, quantity) {
    const product = await Product.findById(productId);
    product.stock = product.stock - quantity;
    await product.save({ validateBeforeSave: false });
}
//Admin: Delete Order - api/v1/order/:id
exports.deleteOrder = catchAsyncError(async (req, res, next) => {
    const order = await Order.findById(req.params.id);
    if(!order) {
        return next(new ErrorHandler(`Order not found with this id: ${req.params.id}`, 404))
    }

    await order.remove();
    res.status(200).json({
        success: true
    })
})


// Return Order - api/v1/order/return/:id
exports.returnOrder = catchAsyncError(async (req, res, next) => {
    const order = await Order.findById(req.params.id).populate('user');

    if (!order) {
        return next(new ErrorHandler('Order not found', 404));
    }

    if (order.orderStatus !== 'Delivered') {
        return next(new ErrorHandler('Only delivered orders can be returned.', 400));
    }

    order.orderStatus = 'Returned';
    order.returnedAt = Date.now();

    // 🔁 Remove user's review from each product in this order
    for (const item of order.orderItems) {
        const product = await Product.findById(item.product);
        if (!product) continue;

        // Remove the review by this user
        product.reviews = product.reviews.filter(
            review => review.user.toString() !== order.user._id.toString()
        );

        // Recalculate numOfReviews and ratings
        product.numOfReviews = product.reviews.length;
        product.ratings =
            product.reviews.reduce((acc, item) => item.rating + acc, 0) /
            (product.reviews.length || 1);

        product.ratings = isNaN(product.ratings) ? 0 : product.ratings;

        await product.save({ validateBeforeSave: false });
    }

    // 📧 Notify the user
   // 🛍️ Build returned product list
const productList = order.orderItems.map(item => {
    return `- ${item.name} (Qty: ${item.quantity}) — $${item.price}`;
}).join('\n');

const message = `
Hi ${order.user.name},

We've received your return request for order #${order._id}.

🛍️ Returned Products:
${productList}

🗑️ Your product reviews for these items have been removed.

We'll process your return shortly.

– The Team
`;


    await sendEmail({
        email: order.user.email,
        subject: 'Return Request Received',
        message
    });

    await order.save();

    res.status(200).json({
        success: true,
        message: 'Return request processed and reviews removed.'
    });
});
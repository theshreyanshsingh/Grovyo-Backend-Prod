const Conversation = require("../models/conversation");
const Message = require("../models/message");
const uuid = require("uuid").v4;
const Minio = require("minio");
const User = require("../models/userAuth");
const admin = require("../fireb");
const moment = require("moment");

const minioClient = new Minio.Client({
  endPoint: "minio.grovyo.xyz",

  useSSL: true,
  accessKey: "shreyansh379",
  secretKey: "shreyansh379",
});

//function to generate a presignedurl of minio
async function generatePresignedUrl(bucketName, objectName, expiry = 604800) {
  try {
    const presignedUrl = await minioClient.presignedGetObject(
      bucketName,
      objectName,
      expiry
    );
    return presignedUrl;
  } catch (err) {
    console.error(err);
    throw new Error("Failed to generate presigned URL");
  }
}

//create a new messsage reqs
exports.createmessagereqs = async (req, res) => {
  const { sender, message, reciever } = req.body;
  try {
    const conv = await Conversation.findOne({
      members: { $all: [sender, reciever] },
    });

    // await Conversation.findOne({
    //   members: { $all: [sender, reciever] },
    // });
    const sendingperson = await User.findById(sender);
    const recievingperson = await User.findById(reciever);
    let blockcheck = false;
    let existsbothway = false;

    //checking if conversation exists in any of the persons phone
    if (
      sendingperson?.conversations?.includes(conv?._id?.toString()) &&
      recievingperson?.conversations?.includes(conv?._id?.toString())
    ) {
      existsbothway = true;
    }

    //checking for blocking
    if (
      sendingperson.blockedpeople.find((f, i) => {
        return f.id.toString() === reciever;
      }) ||
      recievingperson.blockedpeople.find((f, i) => {
        return f.id.toString() === sender;
      })
    ) {
      blockcheck = true;
    }
    if (blockcheck) {
      res.status(201).json({ message: "You are blocked", success: false });
    } else {
      if (conv) {
        if (existsbothway) {
          res.status(203).json({
            success: true,
            covId: conv._id,
            existingreq: false,
            existsbothway: true,
            convexists: true,
          });
        } else {
          res.status(203).json({
            success: true,
            covId: conv._id,
            existingreq: false,
            existsbothway: false,
            convexists: true,
          });
        }
      } else if (!recievingperson) {
        res.status(404).json({
          success: false,
          message: "User not found",
        });
      } else {
        let Reqexits = false;
        //checking for already sent msg request
        for (const reqs of recievingperson.messagerequests) {
          if (reqs.id.toString() === sender) {
            Reqexits = true;
            break;
          }
        }
        for (const reqs of recievingperson.msgrequestsent) {
          if (reqs.id.toString() === sender) {
            Reqexits = true;
            break;
          }
        }
        for (const reqs of sendingperson.msgrequestsent) {
          if (reqs.id.toString() === reciever) {
            Reqexits = true;
            break;
          }
        }
        for (const reqs of sendingperson.messagerequests) {
          if (reqs.id.toString() === reciever) {
            Reqexits = true;
            break;
          }
        }
        if (Reqexits) {
          res.status(200).json({ success: true, existingreq: true });
        } else {
          await User.updateOne(
            { _id: reciever },
            {
              $push: {
                messagerequests: { id: sender, message: message },
              },
            }
          );
          await User.updateOne(
            { _id: sender },
            {
              $push: {
                msgrequestsent: { id: reciever },
              },
            }
          );

          //message for notification
          let date = moment(new Date()).format("hh:mm");
          const msg = {
            notification: {
              title: "A new request has arrived.",
              body: `👋 Extend your hand and accept!!`,
            },
            data: {
              screen: "Requests",
              sender_fullname: `${sendingperson?.fullname}`,
              sender_id: `${sendingperson?._id}`,
              text: "A new request has arrived!!",
              isverified: `${sendingperson?.isverified}`,
              createdAt: `${date}`,
            },
            token: recievingperson?.notificationtoken,
          };

          await admin
            .messaging()
            .send(msg)
            .then((response) => {
              console.log("Successfully sent message");
            })
            .catch((error) => {
              console.log("Error sending message:", error);
            });

          res.status(200).json({ success: true, existingreq: true });
        }
      }
    }
  } catch (e) {
    console.log(e);
    res
      .status(500)
      .json({ message: e.message, success: false, existingreq: false });
  }
};

//accept or reject msg reqs
exports.acceptorrejectmesgreq = async (req, res) => {
  const { sender, status, reciever } = req.body;
  try {
    const conv = await Conversation.findOne({
      members: { $all: [sender, reciever] },
    });
    const user = await User.findById(reciever);
    if (conv) {
      res.status(203).json({ success: false, covId: conv._id });
    } else if (!user) {
      res.status(404).json({
        success: false,
        message: "User not found",
      });
    } else {
      if (status === "accept") {
        await User.updateOne(
          { _id: reciever },
          {
            $pull: {
              messagerequests: { id: sender },
            },
          }
        );
        await User.updateOne(
          { _id: sender },
          {
            $pull: {
              msgrequestsent: { id: reciever },
            },
          }
        );
        const conv = new Conversation({
          members: [sender, reciever],
        });
        const savedconv = await conv.save();
        await User.updateOne(
          { _id: sender },
          {
            $push: {
              conversations: savedconv?._id,
            },
          }
        );
        await User.updateOne(
          { _id: reciever },
          {
            $push: {
              conversations: savedconv?._id,
            },
          }
        );
        res.status(200).json({ savedconv, success: true });
      } else {
        await User.updateOne(
          { _id: reciever },
          {
            $pull: {
              messagerequests: { id: sender },
            },
          }
        );
        await User.updateOne(
          { _id: sender },
          {
            $pull: {
              msgrequestsent: { id: reciever },
            },
          }
        );
        res.status(200).json({ success: true });
      }
    }
  } catch (e) {
    console.log(e);
    res.status(500).json({ message: e.message, success: false });
  }
};

//dm
exports.dm = async (req, res) => {
  const { sender, reciever } = req.body;
  try {
    try {
      const conv = await Conversation.findOne({
        members: { $all: [sender, reciever] },
      });
      const user = await User.findById(reciever);
      if (conv) {
        res.status(203).json({ success: false, covId: conv._id });
      } else if (!user) {
        res.status(404).json({
          success: false,
          message: "User not found",
        });
      } else {
        await User.updateOne(
          { _id: reciever },
          {
            $pull: {
              messagerequests: { id: sender },
            },
          }
        );
        await User.updateOne(
          { _id: sender },
          {
            $pull: {
              msgrequestsent: { id: reciever },
            },
          }
        );
        const conv = new Conversation({
          members: [sender, reciever],
        });
        const savedconv = await conv.save();
        await User.updateOne(
          { _id: sender },
          {
            $push: {
              conversations: savedconv?._id,
            },
          }
        );
        await User.updateOne(
          { _id: reciever },
          {
            $push: {
              conversations: savedconv?._id,
            },
          }
        );
        res.status(200).json({ convId: savedconv?._id, success: true });
      }
    } catch (e) {
      console.log(e);
      res.status(500).json({ message: e.message, success: false });
    }
  } catch (e) {
    console.log(e);
    res.status(500).json({ message: e.message, success: false });
  }
};

//fetch all msg reqs
exports.fetchallmsgreqs = async (req, res) => {
  const { id } = req.params;
  try {
    const user = await User.findById(id).populate({
      path: "messagerequests.id",
      select: "fullname username isverified profilepic",
    });
    if (!user) {
      res.status(404).json({
        success: false,
        message: "User not found",
      });
    } else {
      let dps = [];
      for (let i = 0; i < user.messagerequests.length; i++) {
        const pic = process.env.URL + user?.messagerequests[i].id?.profilepic;

        dps.push(pic);
      }

      res.status(200).json({ reqs: user.messagerequests, dps, success: true });
    }
  } catch (e) {
    res.status(500).json({ message: e.message, success: false });
  }
};

exports.newconv = async (req, res) => {
  const { mine, other } = req.body;
  const conv = new Conversation({
    members: [mine, other],
  });
  const convf = await Conversation.findOne({
    members: { $all: [mine, other] },
  });

  try {
    if (convf) {
      res.status(203).json({ success: false, covId: convf._id });
    } else {
      const savedConv = await conv.save();
      res.status(200).json({ savedConv, success: true });
    }
  } catch (e) {
    res.status(500).json({ message: e.message, success: false });
  }
};

//check if conversation exists
exports.convexists = async (req, res) => {
  const { sender, reciever } = req.body;
  const recievingperson = await User.findById(reciever);
  const sendingperson = await User.findById(sender);
  try {
    const conv = await Conversation.findOne({
      members: { $all: [sender, reciever] },
    })
      .populate("members", "fullname username profilepic isverified")
      .sort({ createdAt: -1 });

    let existsbothway = false;
    if (
      sendingperson?.conversations?.includes(conv?._id?.toString()) &&
      recievingperson?.conversations?.includes(conv?._id?.toString())
    ) {
      existsbothway = true;
    }
    if (conv) {
      if (existsbothway) {
        res.status(200).json({
          success: true,
          existingreq: true,
          existsbothway: true,
        });
      } else {
        res.status(200).json({
          success: true,
          conv,
          existingreq: true,
          existsbothway: false,
        });
      }
    } else {
      if (recievingperson) {
        let Reqexits = false;

        for (const reqs of recievingperson?.messagerequests) {
          if (reqs?.id?.toString() === sendingperson?._id?.toString()) {
            Reqexits = true;
            break;
          }
        }
        for (const reqs of recievingperson?.msgrequestsent) {
          if (reqs?.id?.toString() === sendingperson?._id?.toString()) {
            Reqexits = true;
            break;
          }
        }
        for (const reqs of sendingperson?.msgrequestsent) {
          if (reqs?.id?.toString() === recievingperson?._id?.toString()) {
            Reqexits = true;
            break;
          }
        }
        for (const reqs of sendingperson.messagerequests) {
          if (reqs?.id?.toString() === recievingperson?._id?.toString()) {
            Reqexits = true;
            break;
          }
        }
        if (Reqexits) {
          res.status(200).json({ success: true, existingreq: true });
        } else {
          res.status(203).json({ success: true, existingreq: false });
        }
      } else {
        res.status(404).json({
          message: "User not found",
          success: false,
          existingreq: true,
        });
      }
    }
  } catch (e) {
    console.log(e);
    res
      .status(500)
      .json({ message: e.message, success: false, existingreq: true });
  }
};

//send message to existing person - Chats
exports.sendexistingmsg = async (req, res) => {
  try {
    const { convId } = req.params;
    const { sender, reciever } = req.body;
    const senderperson = await User.findById(sender);
    const recieverperson = await User.findById(reciever);
    if (!senderperson) {
      res.status(404).json({ message: "User not found", success: false });
    } else {
      const conv = await Conversation.findById(convId);
      if (conv) {
        if (
          senderperson?.conversations?.includes(conv?._id?.toString()) &&
          recieverperson?.conversations?.includes(conv?._id?.toString())
        ) {
          res.status(200).json({ success: true });
        } else {
          await User.updateOne(
            { _id: senderperson._id },
            {
              $push: {
                conversations: convId,
              },
            }
          );
          res.status(200).json({ success: true });
        }
      } else {
        res
          .status(404)
          .json({ message: "Conversation not found", success: false });
      }
    }
  } catch (e) {
    console.log(e);
    res.status(400).json({ message: e.message, success: false });
  }
};

exports.getallconv = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    const conv = await Conversation.find({
      members: req.params.userId,
    }).populate("members", "fullname profilepic isverified");

    if (!user) {
      res.status(404).json({ message: "User not found", success: false });
    } else {
      //check latest message
      let message = [];
      for (let i = 0; i < conv.length; i++) {
        const m = await Message.find({ conversationId: conv[i]._id })
          .sort({ createdAt: -1 })
          .limit(1);
        message.push(...m);
      }

      const receiver = [];
      //checking the reciever
      for (let i = 0; i < conv.length; i++) {
        for (let j = 0; j < conv[i].members.length; j++) {
          if (conv[i].members[j]._id.toString() !== req.params.userId) {
            const receiving = conv[i].members[j];
            receiver.push(receiving);
          }
        }
      }

      //for genrating prsignurl of reciever
      const receiverdp = [];
      for (let i = 0; i < conv.length; i++) {
        for (let j = 0; j < conv[i].members.length; j++) {
          if (conv[i].members[j]._id.toString() !== req.params.userId) {
            const a = await generatePresignedUrl(
              "images",
              conv[i].members[j].profilepic.toString(),
              60 * 60
            );
            receiverdp.push(a);
          }
        }
      }

      res.status(200).json({
        data: {
          conv,
          reqcount: user?.messagerequests?.length,
          receiver,
          receiverdp,
          message,
        },
        success: true,
      });
    }
  } catch (e) {
    res.status(500).json({ message: e.message, success: false });
  }
};

exports.getoneconv = async (req, res) => {
  const { convId, id } = req.params;
  const time = new Date(Date.now() - 24 * 60 * 60 * 1000);

  try {
    const conv = await Message.find({
      conversationId: convId,
      hidden: { $nin: [id] },

      $or: [
        { dissapear: false },
        { createdAt: { $gt: time }, dissapear: true },
      ],
    })
      .limit(30)
      .sort({ createdAt: -1 });

    let content = [];
    for (let i = 0; i < conv.length; i++) {
      if (conv[i].content) {
        const a = await generatePresignedUrl(
          "messages",
          conv[i].content.toString(),
          60 * 60
        );
        content.push(a);
      } else if (conv[i].content) {
        const a = await generatePresignedUrl(
          "messages",
          conv[i].content.toString(),
          60 * 60
        );
        content.push(a);
      } else if (conv[i].content) {
        const a = await generatePresignedUrl(
          "messages",
          conv[i].content.toString(),
          60 * 60
        );
        content.push(a);
      } else {
        content.push("Nothing");
      }
    }

    const reversedConv = conv.reverse();
    const reversedCont = content.reverse();
    if (!conv) {
      res
        .status(404)
        .json({ message: "Conversation not found", success: false });
    } else {
      res.status(200).json({ reversedConv, reversedCont, success: true });
    }
  } catch (e) {
    res.status(400).json({ message: e.message, success: false });
  }
};

exports.removeconversation = async (req, res) => {
  try {
    const { id } = req.params;
    const { convId } = req.body;
    const user = await User.findById(id);
    if (!user) {
      res.status(404).json({ message: "User not found", success: false });
    } else {
      await User.updateOne(
        { _id: id },
        {
          $pull: {
            conversations: convId,
          },
        }
      );
      res.status(200).json({ success: true });
    }
  } catch (e) {
    res.status(400).json({ message: e.message, success: false });
  }
};

exports.gettoken = async (req, res) => {
  const { id } = req.params;
  try {
    const user = await User.findById(id);
    if (!user) {
      res.status(404).json({ message: "No user found" });
    } else {
      const token = await user.token;
      res.status(200).json(token);
    }
  } catch (e) {
    res.status(400).json(e.message);
  }
};

//create msg req new
exports.createmessagereqnew = async (req, res) => {
  try {
    const { sender, message, reciever } = req.body;
    const sendingperson = await User.findById(sender);
    const recievingperson = await User.findById(reciever);

    let Reqexits = false;
    const conv = await Conversation.findOne({
      members: { $all: [sender, reciever] },
    });
    if (sendingperson && recievingperson) {
      if (conv) {
        res.status(203).json({
          success: true,
          covId: conv._id,
          convexists: true,
        });
      } else {
        //checking if req exits in both persons
        if (
          sendingperson?.conversations?.includes(conv?._id?.toString()) &&
          recievingperson?.conversations?.includes(conv?._id?.toString())
        ) {
          res
            .status(203)
            .json({ message: "Conv exists both ways!", success: false });
        }
        //checking if anyone is blocked
        else if (
          sendingperson.blockedpeople.find((f, i) => {
            return f.id.toString() === reciever;
          }) ||
          recievingperson.blockedpeople.find((f, i) => {
            return f.id.toString() === sender;
          })
        ) {
          res.status(203).json({ message: "You are blocked", success: false });
        } else {
          for (const reqs of recievingperson.messagerequests) {
            if (reqs.id.toString() === sender) {
              Reqexits = true;
              break;
            }
          }
          for (const reqs of recievingperson.msgrequestsent) {
            if (reqs.id.toString() === sender) {
              Reqexits = true;
              break;
            }
          }
          for (const reqs of sendingperson.msgrequestsent) {
            if (reqs.id.toString() === reciever) {
              Reqexits = true;
              break;
            }
          }
          for (const reqs of sendingperson.messagerequests) {
            if (reqs.id.toString() === reciever) {
              Reqexits = true;
              break;
            }
          }
          if (Reqexits) {
            res.status(200).json({ success: true, existingreq: true });
          } else {
            await User.updateOne(
              { _id: reciever },
              {
                $push: {
                  messagerequests: { id: sender, message: message },
                },
              }
            );
            await User.updateOne(
              { _id: sender },
              {
                $push: {
                  msgrequestsent: { id: reciever },
                },
              }
            );

            //message for notification
            let date = moment(new Date()).format("hh:mm");
            const msg = {
              notification: {
                title: "A new request has arrived.",
                body: `👋 Extend your hand and accept!!`,
              },
              data: {
                screen: "Requests",
                sender_fullname: `${sendingperson?.fullname}`,
                sender_id: `${sendingperson?._id}`,
                text: "A new request has arrived!!",
                isverified: `${sendingperson?.isverified}`,
                createdAt: `${date}`,
              },
              token: recievingperson?.notificationtoken,
            };

            await admin
              .messaging()
              .send(msg)
              .then((response) => {
                console.log("Successfully sent message");
              })
              .catch((error) => {
                console.log("Error sending message:", error);
              });

            res.status(200).json({ success: true });
          }
        }
      }
    } else {
      res.status(404).json({ message: "Invalid users", success: false });
    }
  } catch (e) {
    console.log(e);
    res.status(400).json({ message: "Something went wrong", success: false });
  }
};

//fetch convs new
exports.fetchallchatsnew = async (req, res) => {
  try {
    const { id } = req.params;
    const { convids } = req.body;
    const user = await User.findById(id);

    if (user) {
      let reqcount = user?.messagerequests?.length;
      let conv = [];
      let ids;
      if (convids?.length > 0) {
        ids = getUniqueObjectIds(convids, user.conversations);
      } else {
        ids = user.conversations;
      }

      for (let i = 0; i < ids.length; i++) {
        const convs = await Conversation.findById(ids[i]).populate(
          "members",
          "fullname username profilepic isverified blockedpeople"
        );

        //if convs is null then remove it
        if (!convs) {
          await User.updateOne(
            { _id: user._id },
            { $pull: { conversations: ids[i] } }
          );
        }

        const msg = await Message.find({
          conversationId: convs?._id,
          //status: "active",
          hidden: { $nin: [user._id.toString()] },
          deletedfor: { $nin: [user._id] },
        })
          .limit(1)
          .sort({ createdAt: -1 });

        for (let j = 0; j < convs?.members?.length; j++) {
          if (convs.members[j]._id?.toString() !== user._id.toString()) {
            const pi = process.env.URL + convs?.members[j]?.profilepic;

            //checking the blocking
            let isblocked = false;
            let other = await User.findById(convs.members[j]._id?.toString());
            if (other) {
              other.blockedpeople.forEach((p) => {
                if (p?.id?.toString() === id) {
                  isblocked = true;
                }
              });
            }
            //counting unread msgs
            let unread = 0;
            const msgcount = await Message.find({
              conversationId: convs?._id,
              status: "active",
              deletedfor: { $nin: [user._id.toString()] },
              hidden: { $nin: [user._id.toString()] },
            })
              .limit(20)
              .sort({ createdAt: -1 });
            for (let k = 0; k < msgcount.length; k++) {
              if (
                !msgcount[k].readby.includes(id) &&
                msgcount[k].sender?.toString() !== id
              ) {
                unread++;
              }
            }

            let result = {
              convid: convs?._id,
              id: convs?.members[j]?._id,
              fullname: convs?.members[j]?.fullname,
              username: convs?.members[j]?.username,
              isverified: convs?.members[j]?.isverified,
              pic: pi,
              msgs: isblocked ? [] : msg,
              ismuted: user.muted?.includes(convs._id),
              unread,
            };

            conv.push(result);
          } else {
            null;
          }
        }
      }
      conv.sort((c1, c2) => {
        const timeC1 = c1?.msgs[0]?.createdAt || 0;
        const timeC2 = c2?.msgs[0]?.createdAt || 0;
        return timeC2 - timeC1;
      });
      res.status(200).json({ success: true, reqcount, conv });
    } else {
      res.status(404).json({ message: "User not found", success: false });
    }
  } catch (e) {
    console.log(e);
    res.status(400).json({ message: "Something went wrong", success: false });
  }
};

//hidden code forgot reset
exports.resethidden = async (req, res) => {
  try {
    const { id } = req.body;
    const user = await User.findById(id);

    //generating mesId
    function msgid() {
      return Math.floor(100000 + Math.random() * 900000);
    }

    function generateRandomCode() {
      const randomNumber = Math.floor(Math.random() * 900000) + 100000;

      const randomCode = randomNumber.toString();

      return randomCode;
    }

    if (user) {
      let code = generateRandomCode();
      await User.updateOne({ _id: user._id }, { $set: { passcode: code } });

      const grovyo = await User.findById("65a666a3e953a4573e6c7ecf");
      const convs = await Conversation.findOne({
        members: { $all: [user?._id, grovyo._id] },
      });
      const senderpic = process.env.URL + grovyo.profilepic;
      const recpic = process.env.URL + user.profilepic;
      const timestamp = `${new Date()}`;
      const mesId = msgid();
      if (convs) {
        let data = {
          conversationId: convs._id,
          sender: grovyo._id,
          text: `Your code to access your Hidden Chats is ${code}.`,
          mesId: mesId,
        };
        const m = new Message(data);
        await m.save();

        if (user?.notificationtoken) {
          const msg = {
            notification: {
              title: `Grovyo`,
              body: `Your code to access your Hidden Chats is ${code}.`,
            },
            data: {
              screen: "Conversation",
              sender_fullname: `${grovyo?.fullname}`,
              sender_id: `${grovyo?._id}`,
              text: `Your code to access your Hidden Chats is ${code}.`,
              convId: `${convs?._id}`,
              createdAt: `${timestamp}`,
              mesId: `${mesId}`,
              typ: `message`,
              senderuname: `${grovyo?.username}`,
              senderverification: `${grovyo.isverified}`,
              senderpic: `${senderpic}`,
              reciever_fullname: `${user.fullname}`,
              reciever_username: `${user.username}`,
              reciever_isverified: `${user.isverified}`,
              reciever_pic: `${recpic}`,
              reciever_id: `${user._id}`,
            },
            token: user?.notificationtoken,
          };

          await admin
            .messaging()
            .send(msg)
            .then((response) => {
              console.log("Successfully sent message");
            })
            .catch((error) => {
              console.log("Error sending message:", error);
            });
        }
      } else {
        const conv = new Conversation({
          members: [grovyo._id, user._id],
        });
        const savedconv = await conv.save();
        let data = {
          conversationId: conv._id,
          sender: grovyo._id,
          text: `Your code for your Hidden Chats is ${code}.`,
          mesId: mesId,
        };
        await User.updateOne(
          { _id: grovyo._id },
          {
            $addToSet: {
              conversations: savedconv?._id,
            },
          }
        );
        await User.updateOne(
          { _id: user._id },
          {
            $addToSet: {
              conversations: savedconv?._id,
            },
          }
        );

        const m = new Message(data);
        await m.save();

        const msg = {
          notification: {
            title: `Grovyo`,
            body: `Your code to access your Hidden Chats is ${code}.`,
          },
          data: {
            screen: "Conversation",
            sender_fullname: `${grovyo?.fullname}`,
            sender_id: `${grovyo?._id}`,
            text: `Your code to access your Hidden Chats is ${code}.`,
            convId: `${convs?._id}`,
            createdAt: `${timestamp}`,
            mesId: `${mesId}`,
            typ: `message`,
            senderuname: `${grovyo?.username}`,
            senderverification: `${grovyo.isverified}`,
            senderpic: `${senderpic}`,
            reciever_fullname: `${user.fullname}`,
            reciever_username: `${user.username}`,
            reciever_isverified: `${user.isverified}`,
            reciever_pic: `${recpic}`,
            reciever_id: `${user._id}`,
          },
          token: user?.notificationtoken,
        };

        await admin
          .messaging()
          .send(msg)
          .then((response) => {
            console.log("Successfully sent message");
          })
          .catch((error) => {
            console.log("Error sending message:", error);
          });
      }
      res.status(200).json({ success: true });
    } else {
      res.status(404).json({ message: "User not found", success: false });
    }
  } catch (e) {
    console.log(e);
    res.status(400).json({ success: false });
  }
};

//getting non similar elements our of two arrays
const getUniqueObjectIds = (a, b) => {
  // Create Sets to store unique ObjectIds
  const setA = new Set(a.map((id) => id.toString())); // Convert ObjectId to string for unique comparison
  const setB = new Set(b.map((id) => id.toString()));

  // Get unique ObjectIds from array A that are not in B
  const uniqueToA = a.filter((id) => !setB.has(id.toString()));

  // Get unique ObjectIds from array B that are not in A
  const uniqueToB = b.filter((id) => !setA.has(id.toString()));

  // Combine the unique results
  return [...uniqueToA, ...uniqueToB];
};
